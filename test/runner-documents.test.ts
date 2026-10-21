import assert from 'node:assert/strict'
import { test } from 'node:test'
import { migrate } from '../src/db/migrate.js'
import type { DownloadRequest, DownloadResult } from '../src/http/download.js'
import { createLogger } from '../src/log.js'
import { runSource, type RunnerDependencies } from '../src/sync/runner.js'
import type { Source } from '../src/sync/source.js'
import { PgliteDatabase } from './pglite-database.js'

const index = 'https://fonte.example/downloads'
const small = 'https://fonte.example/a.txt'
const large = 'https://fonte.example/b.txt'

function document(url: string, body: string, etag: string): DownloadResult {
  return { status: 'downloaded', url, body: Buffer.from(body), etag, lastModified: null, contentType: 'text/plain' }
}

async function setup() {
  const database = await PgliteDatabase.create()
  await migrate(database)
  const extracted: string[][] = []
  const source: Source = {
    id: 'docs',
    allowedHosts: ['fonte.example'],
    contentTypes: ['text/plain'],
    license: 'teste',
    defaultIntervalHours: 24,
    async locate(fetchPage) {
      return (await fetchPage(index)).split('\n')
    },
    async extract(documents) {
      extracted.push(documents.map((item) => `${item.url}=${item.body.toString('utf8')}`))
      return { captured: documents.length, rejected: 0, publish: async () => ({ created: 0, updated: 0, unchanged: 0, retired: 0 }) }
    },
    countPublished: async () => 0,
  }
  const served = new Map<string, DownloadResult[]>()
  const requests: DownloadRequest[] = []
  const clock = { now: new Date('2026-10-20T06:00:00Z') }
  const dependencies: RunnerDependencies = {
    database,
    logger: createLogger('silent'),
    holder: 'teste',
    lockLeaseMinutes: 60,
    maxDropRatio: 0.2,
    retainPayloadMaxBytes: 5,
    intervalHours: () => 24,
    now: () => clock.now,
    async download(request) {
      requests.push(request)
      if (request.url === index) return document(index, `${small}\n${large}`, '"i"')
      const next = served.get(request.url)?.shift()
      if (!next) throw new Error(`sem resposta para ${request.url}`)
      return next
    },
  }
  return { database, source, served, requests, clock, extracted, dependencies }
}

test('descobre documentos pelo índice e reaproveita os inalterados quando outro muda', async () => {
  const { database, source, served, requests, clock, extracted, dependencies } = await setup()
  served.set(small, [document(small, 'a1', '"a1"')])
  served.set(large, [document(large, 'grande-1', '"b1"')])
  assert.equal((await runSource(source, { trigger: 'schedule', force: false }, dependencies)).status, 'succeeded')

  clock.now = new Date('2026-10-21T06:00:00Z')
  served.set(small, [document(small, 'a2', '"a2"')])
  served.set(large, [{ status: 'not-modified' }, document(large, 'grande-1', '"b1"')])
  assert.equal((await runSource(source, { trigger: 'schedule', force: false }, dependencies)).status, 'succeeded')

  assert.deepEqual(extracted, [
    [`${small}=a1`, `${large}=grande-1`],
    [`${small}=a2`, `${large}=grande-1`],
  ])
  const largeRequests = requests.filter((request) => request.url === large)
  assert.deepEqual(
    largeRequests.map((request) => request.etag),
    [null, '"b1"', null],
  )
  const stored = await database.query<{ url: string; retained: boolean }>(
    'SELECT url, payload_gzip IS NOT NULL AS retained FROM catalog_sync.source_records ORDER BY url, first_fetched_at',
  )
  assert.deepEqual(
    stored.map((row) => `${row.url}:${row.retained}`),
    [`${small}:true`, `${small}:true`, `${large}:false`],
  )
})

test('encerra como inalterada quando todos os documentos respondem 304', async () => {
  const { source, served, clock, extracted, dependencies, database } = await setup()
  served.set(small, [document(small, 'a1', '"a1"'), { status: 'not-modified' }])
  served.set(large, [document(large, 'grande-1', '"b1"'), { status: 'not-modified' }])
  await runSource(source, { trigger: 'schedule', force: false }, dependencies)

  clock.now = new Date('2026-10-21T06:00:00Z')
  assert.equal((await runSource(source, { trigger: 'schedule', force: false }, dependencies)).status, 'unchanged')
  assert.equal(extracted.length, 1)
  const [documents] = await database.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM catalog_sync.sync_run_documents d
     JOIN catalog_sync.sync_runs r ON r.id = d.run_id WHERE r.status = 'unchanged'`,
  )
  assert.equal(documents?.total, 2)
})
