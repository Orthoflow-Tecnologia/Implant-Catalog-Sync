import assert from 'node:assert/strict'
import { test } from 'node:test'
import { migrate } from '../src/db/migrate.js'
import type { DownloadRequest, DownloadResult, Downloader } from '../src/http/download.js'
import { createLogger } from '../src/log.js'
import { runSource, type RunnerDependencies } from '../src/sync/runner.js'
import type { Source } from '../src/sync/source.js'
import { PgliteDatabase } from './pglite-database.js'

const fakeUrl = 'https://fonte.example/itens.json'

const fakeSource: Source = {
  id: 'fake',
  allowedHosts: ['fonte.example'],
  contentTypes: ['application/json'],
  license: 'teste',
  defaultIntervalHours: 24,
  locate: async () => [fakeUrl],
  async extract([document]) {
    const items: unknown = JSON.parse(document?.body.toString('utf8') ?? '')
    if (!Array.isArray(items)) throw new Error('formato inesperado')
    const names = items.filter((item): item is string => typeof item === 'string')
    return {
      captured: names.length,
      rejected: items.length - names.length,
      async publish(tx) {
        const existing = new Set((await tx.query<{ name: string }>('SELECT name FROM fake_items')).map((row) => row.name))
        let created = 0
        for (const name of names) {
          if (existing.has(name)) continue
          await tx.query('INSERT INTO fake_items (name) VALUES ($1)', [name])
          created += 1
        }
        return { created, updated: 0, unchanged: names.length - created, retired: 0 }
      },
    }
  },
  async countPublished(db) {
    const [row] = await db.query<{ total: number }>('SELECT count(*)::int AS total FROM fake_items')
    return row?.total ?? 0
  },
}

type Harness = {
  database: PgliteDatabase
  responses: DownloadResult[]
  requests: DownloadRequest[]
  clock: { now: Date }
  dependencies: RunnerDependencies
}

function json(value: unknown, etag = '"v1"'): DownloadResult {
  return {
    status: 'downloaded',
    url: fakeUrl,
    body: Buffer.from(JSON.stringify(value)),
    etag,
    lastModified: null,
    contentType: 'application/json',
  }
}

async function harness(): Promise<Harness> {
  const database = await PgliteDatabase.create()
  await migrate(database)
  await database.exec('CREATE TABLE fake_items (name text PRIMARY KEY)')
  const responses: DownloadResult[] = []
  const requests: DownloadRequest[] = []
  const clock = { now: new Date('2026-10-20T06:00:00Z') }
  const download: Downloader = async (request) => {
    requests.push(request)
    const next = responses.shift()
    if (!next) throw new Error('sem resposta configurada')
    return next
  }
  return {
    database,
    responses,
    requests,
    clock,
    dependencies: {
      database,
      download,
      logger: createLogger('silent'),
      holder: 'teste',
      lockLeaseMinutes: 60,
      maxDropRatio: 0.2,
      retainPayloadMaxBytes: 1024,
      intervalHours: (source) => source.defaultIntervalHours,
      now: () => clock.now,
    },
  }
}

const schedule = { trigger: 'schedule', force: false } as const

async function runs(database: PgliteDatabase) {
  return database.query<{ status: string; created: number; unchanged: number; error: string | null }>(
    'SELECT status, created, unchanged, error FROM catalog_sync.sync_runs ORDER BY started_at',
  )
}

test('publica, registra a execução e guarda o payload bruto uma vez por checksum', async () => {
  const { database, responses, dependencies, clock } = await harness()
  responses.push(json(['a', 'b']))
  assert.equal((await runSource(fakeSource, schedule, dependencies)).status, 'succeeded')

  clock.now = new Date('2026-10-21T06:00:00Z')
  responses.push(json(['a', 'b'], '"v2"'))
  assert.equal((await runSource(fakeSource, schedule, dependencies)).status, 'unchanged')

  assert.deepEqual(await runs(database), [
    { status: 'succeeded', created: 2, unchanged: 0, error: null },
    { status: 'unchanged', created: 0, unchanged: 0, error: null },
  ])
  const [records] = await database.query<{ total: number }>('SELECT count(*)::int AS total FROM catalog_sync.source_records')
  assert.equal(records?.total, 1)
})

test('envia ETag do último payload publicado e trata 304 como sem alterações', async () => {
  const { database, responses, requests, dependencies, clock } = await harness()
  responses.push(json(['a']))
  await runSource(fakeSource, schedule, dependencies)

  clock.now = new Date('2026-10-21T05:50:00Z')
  responses.push({ status: 'not-modified' })
  assert.equal((await runSource(fakeSource, schedule, dependencies)).status, 'unchanged')
  assert.equal(requests[1]?.etag, '"v1"')
  assert.equal((await runs(database)).length, 2)
})

test('respeita o intervalo da fonte e permite reexecução manual forçada', async () => {
  const { database, responses, requests, dependencies, clock } = await harness()
  responses.push(json(['a']))
  await runSource(fakeSource, schedule, dependencies)

  clock.now = new Date('2026-10-20T12:00:00Z')
  assert.equal((await runSource(fakeSource, schedule, dependencies)).status, 'not-due')

  responses.push(json(['a']))
  assert.equal((await runSource(fakeSource, { trigger: 'manual', force: true }, dependencies)).status, 'succeeded')
  assert.equal(requests[1]?.etag, null)
  const [items] = await database.query<{ total: number }>('SELECT count(*)::int AS total FROM fake_items')
  assert.equal(items?.total, 1)
})

test('não executa enquanto outro processo detém o lock válido', async () => {
  const { database, dependencies, requests } = await harness()
  await database.query(
    `INSERT INTO catalog_sync.source_locks (source_id, holder, locked_until) VALUES ('fake', 'outro', '2026-10-20T06:30:00Z')`,
  )
  assert.equal((await runSource(fakeSource, schedule, dependencies)).status, 'locked')
  assert.equal(requests.length, 0)
})

test('assume lock expirado e encerra execução órfã como falha', async () => {
  const { database, responses, dependencies } = await harness()
  await database.query(
    `INSERT INTO catalog_sync.source_locks (source_id, holder, locked_until) VALUES ('fake', 'morto', '2026-10-20T05:00:00Z')`,
  )
  await database.query(
    `INSERT INTO catalog_sync.sync_runs (source_id, trigger, status, trace_id, started_at)
     VALUES ('fake', 'schedule', 'running', 't', '2026-10-20T04:00:00Z')`,
  )
  responses.push(json(['a']))
  assert.equal((await runSource(fakeSource, schedule, dependencies)).status, 'succeeded')
  const statuses = (await runs(database)).map((run) => run.status)
  assert.deepEqual(statuses, ['failed', 'succeeded'])
  const locks = await database.query('SELECT * FROM catalog_sync.source_locks')
  assert.equal(locks.length, 0)
})

test('falha de formato mantém o catálogo publicado e libera nova tentativa', async () => {
  const { database, responses, dependencies, clock } = await harness()
  responses.push(json(['a']))
  await runSource(fakeSource, schedule, dependencies)

  clock.now = new Date('2026-10-21T06:00:00Z')
  responses.push(json({ formato: 'novo' }))
  assert.equal((await runSource(fakeSource, schedule, dependencies)).status, 'failed')

  clock.now = new Date('2026-10-21T07:00:00Z')
  responses.push(json(['a', 'b'], '"v3"'))
  assert.equal((await runSource(fakeSource, schedule, dependencies)).status, 'succeeded')
  const [items] = await database.query<{ total: number }>('SELECT count(*)::int AS total FROM fake_items')
  assert.equal(items?.total, 2)
  assert.equal((await runs(database))[1]?.error, 'formato inesperado')
})

test('bloqueia publicação quando a fonte encolhe além do limite', async () => {
  const { database, responses, dependencies, clock } = await harness()
  responses.push(json(['a', 'b', 'c', 'd', 'e']))
  await runSource(fakeSource, schedule, dependencies)

  clock.now = new Date('2026-10-21T06:00:00Z')
  responses.push(json(['a', 'b', 'c'], '"v2"'))
  assert.equal((await runSource(fakeSource, schedule, dependencies)).status, 'failed')
  assert.match((await runs(database))[1]?.error ?? '', /publicação bloqueada/)
})
