import { createHash, randomUUID } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import type { Database, Queryable } from '../db/database.js'
import type { Downloaded, Downloader } from '../http/download.js'
import type { Logger } from '../log.js'
import type { Source, SourceDocument } from './source.js'

export type Trigger = 'schedule' | 'manual'

export type RunOutcome = {
  sourceId: string
  status: 'succeeded' | 'unchanged' | 'failed' | 'not-due' | 'locked'
  runId?: string
}

export type RunnerDependencies = {
  database: Database
  download: Downloader
  logger: Logger
  holder: string
  lockLeaseMinutes: number
  maxDropRatio: number
  retainPayloadMaxBytes: number
  intervalHours(source: Source): number
  now?: () => Date
}

export class SuspiciousDropError extends Error {
  constructor(previous: number, captured: number) {
    super(`Fonte trouxe ${captured} itens contra ${previous} publicados; publicação bloqueada para revisão.`)
    this.name = 'SuspiciousDropError'
  }
}

// O cron dispara no mesmo minuto todo dia; sem folga, uma execução 30s mais lenta empurraria a próxima para o dia seguinte.
const scheduleGraceMs = 15 * 60 * 1000
const hourMs = 60 * 60 * 1000
const pageContentTypes = ['text/html', 'application/xml', 'text/xml']

type BaselineDocument = { url: string; source_record_id: string; checksum: string; etag: string | null; last_modified: string | null }
type Baseline = { checksum: string; documents: Map<string, BaselineDocument> }
type Fetched = { url: string; recordId: string; checksum: string; body: Buffer | null }

function sha256(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex')
}

function combinedChecksum(documents: readonly Fetched[]): string {
  const [only] = documents
  if (documents.length === 1 && only) return only.checksum
  const lines = documents.map((document) => `${document.url} ${document.checksum}`).sort()
  return createHash('sha256').update(lines.join('\n')).digest('hex')
}

async function isDue(database: Database, source: Source, intervalHours: number, now: Date): Promise<boolean> {
  const [row] = await database.query<{ last: Date | null }>(
    `SELECT max(started_at) AS last FROM catalog_sync.sync_runs
     WHERE source_id = $1 AND status IN ('succeeded', 'unchanged')`,
    [source.id],
  )
  if (!row?.last) return true
  return now.getTime() - new Date(row.last).getTime() >= intervalHours * hourMs - scheduleGraceMs
}

async function acquireLock(database: Database, sourceId: string, holder: string, now: Date, leaseMinutes: number): Promise<boolean> {
  const rows = await database.query(
    `INSERT INTO catalog_sync.source_locks (source_id, holder, locked_until) VALUES ($1, $2, $3)
     ON CONFLICT (source_id) DO UPDATE SET holder = EXCLUDED.holder, locked_until = EXCLUDED.locked_until
     WHERE catalog_sync.source_locks.locked_until < $4
     RETURNING holder`,
    [sourceId, holder, new Date(now.getTime() + leaseMinutes * 60_000), now],
  )
  return rows.length === 1
}

async function releaseLock(database: Database, sourceId: string, holder: string): Promise<void> {
  await database.query('DELETE FROM catalog_sync.source_locks WHERE source_id = $1 AND holder = $2', [sourceId, holder])
}

async function baselineFor(database: Database, sourceId: string): Promise<Baseline | null> {
  const [run] = await database.query<{ id: string; checksum: string }>(
    `SELECT id, checksum FROM catalog_sync.sync_runs
     WHERE source_id = $1 AND status IN ('succeeded', 'unchanged') AND checksum IS NOT NULL
     ORDER BY started_at DESC
     LIMIT 1`,
    [sourceId],
  )
  if (!run) return null
  const documents = await database.query<BaselineDocument>(
    `SELECT d.url, r.id AS source_record_id, r.checksum, r.etag, r.last_modified
     FROM catalog_sync.sync_run_documents d
     JOIN catalog_sync.source_records r ON r.id = d.source_record_id
     WHERE d.run_id = $1`,
    [run.id],
  )
  return { checksum: run.checksum, documents: new Map(documents.map((document) => [document.url, document])) }
}

async function storedPayload(database: Database, recordId: string): Promise<Buffer | null> {
  const [row] = await database.query<{ payload_gzip: Uint8Array | null }>(
    'SELECT payload_gzip FROM catalog_sync.source_records WHERE id = $1',
    [recordId],
  )
  return row?.payload_gzip ? gunzipSync(row.payload_gzip) : null
}

async function storeSourceRecord(
  database: Database,
  source: Source,
  downloaded: Downloaded,
  checksum: string,
  now: Date,
  retainPayloadMaxBytes: number,
): Promise<string> {
  const payload = downloaded.body.byteLength <= retainPayloadMaxBytes ? gzipSync(downloaded.body) : null
  const [row] = await database.query<{ id: string }>(
    `INSERT INTO catalog_sync.source_records
       (source_id, url, license, checksum, etag, last_modified, content_type, byte_size, payload_gzip, first_fetched_at, last_fetched_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
     ON CONFLICT (source_id, checksum) DO UPDATE SET
       last_fetched_at = EXCLUDED.last_fetched_at,
       etag = EXCLUDED.etag,
       last_modified = EXCLUDED.last_modified,
       payload_gzip = coalesce(catalog_sync.source_records.payload_gzip, EXCLUDED.payload_gzip)
     RETURNING id`,
    [
      source.id,
      downloaded.url,
      source.license,
      checksum,
      downloaded.etag,
      downloaded.lastModified,
      downloaded.contentType,
      downloaded.body.byteLength,
      payload,
      now,
    ],
  )
  if (!row) throw new Error('Falha ao registrar o documento bruto.')
  return row.id
}

async function recordDocuments(tx: Queryable, runId: string, documents: readonly Fetched[]): Promise<void> {
  for (const document of documents) {
    await tx.query('INSERT INTO catalog_sync.sync_run_documents (run_id, source_record_id, url) VALUES ($1, $2, $3)', [
      runId,
      document.recordId,
      document.url,
    ])
  }
}

export async function runSource(
  source: Source,
  options: { trigger: Trigger; force: boolean },
  dependencies: RunnerDependencies,
): Promise<RunOutcome> {
  const { database, logger: baseLogger, holder, download } = dependencies
  const now = dependencies.now ?? (() => new Date())
  const logger = baseLogger.child({ source: source.id })
  const startedAt = now()

  if (!options.force && !(await isDue(database, source, dependencies.intervalHours(source), startedAt))) {
    logger.debug('fonte fora do intervalo; nada a fazer')
    return { sourceId: source.id, status: 'not-due' }
  }
  if (!(await acquireLock(database, source.id, holder, startedAt, dependencies.lockLeaseMinutes))) {
    logger.warn('outra execução detém o lock da fonte')
    return { sourceId: source.id, status: 'locked' }
  }

  try {
    await database.query(
      `UPDATE catalog_sync.sync_runs SET status = 'failed', error = 'Execução interrompida antes de concluir.', finished_at = $2
       WHERE source_id = $1 AND status = 'running'`,
      [source.id, startedAt],
    )
    const traceId = randomUUID()
    const [run] = await database.query<{ id: string }>(
      `INSERT INTO catalog_sync.sync_runs (source_id, trigger, status, trace_id, started_at)
       VALUES ($1, $2, 'running', $3, $4) RETURNING id`,
      [source.id, options.trigger, traceId, startedAt],
    )
    if (!run) throw new Error('Falha ao registrar a execução.')
    const runLogger = logger.child({ runId: run.id, traceId, trigger: options.trigger })
    runLogger.info('sincronização iniciada')

    try {
      const fetchDocument = (url: string, conditional: BaselineDocument | undefined) =>
        download({
          url,
          allowedHosts: source.allowedHosts,
          contentTypes: source.contentTypes,
          etag: conditional?.etag ?? null,
          lastModified: conditional?.last_modified ?? null,
        })
      const fetchPage = async (url: string): Promise<string> => {
        const page = await download({ url, allowedHosts: source.allowedHosts, contentTypes: pageContentTypes, etag: null, lastModified: null })
        if (page.status !== 'downloaded') throw new Error(`Página de índice sem conteúdo: ${url}`)
        return page.body.toString('utf8')
      }

      const urls = [...new Set(await source.locate(fetchPage))]
      if (urls.length === 0) throw new Error('A fonte não listou nenhum documento.')

      const baseline = await baselineFor(database, source.id)
      const fetched: Fetched[] = []
      for (const url of urls) {
        const previous = baseline?.documents.get(url)
        const result = await fetchDocument(url, options.force ? undefined : previous)
        if (result.status === 'not-modified') {
          if (!previous) throw new Error(`Fonte respondeu 304 sem documento anterior registrado: ${url}`)
          fetched.push({ url, recordId: previous.source_record_id, checksum: previous.checksum, body: null })
          continue
        }
        const checksum = sha256(result.body)
        const recordId = await storeSourceRecord(database, source, result, checksum, now(), dependencies.retainPayloadMaxBytes)
        fetched.push({ url, recordId, checksum, body: result.body })
      }

      const checksum = combinedChecksum(fetched)
      if (!options.force && baseline?.checksum === checksum) {
        await database.transaction(async (tx) => {
          await recordDocuments(tx, run.id, fetched)
          await tx.query(`UPDATE catalog_sync.sync_runs SET status = 'unchanged', checksum = $2, finished_at = $3 WHERE id = $1`, [
            run.id,
            checksum,
            now(),
          ])
        })
        runLogger.info('documentos idênticos aos da última publicação', { checksum, documents: fetched.length })
        return { sourceId: source.id, status: 'unchanged', runId: run.id }
      }

      const documents: SourceDocument[] = []
      for (const document of fetched) {
        let body = document.body ?? (await storedPayload(database, document.recordId))
        if (body === null) {
          const again = await fetchDocument(document.url, undefined)
          if (again.status !== 'downloaded' || sha256(again.body) !== document.checksum) {
            throw new Error(`Documento mudou durante a execução: ${document.url}`)
          }
          body = again.body
        }
        documents.push({ url: document.url, body })
      }

      const extraction = await source.extract(documents)
      const previous = await source.countPublished(database)
      if (previous > 0 && extraction.captured < previous * (1 - dependencies.maxDropRatio)) {
        throw new SuspiciousDropError(previous, extraction.captured)
      }

      const counts = await database.transaction(async (tx) => {
        const published = await extraction.publish(tx, { runId: run.id, now: startedAt, logger: runLogger })
        await recordDocuments(tx, run.id, fetched)
        await tx.query(
          `UPDATE catalog_sync.sync_runs SET
             status = 'succeeded', checksum = $2, captured = $3, rejected = $4,
             created = $5, updated = $6, unchanged = $7, retired = $8, finished_at = $9
           WHERE id = $1`,
          [
            run.id,
            checksum,
            extraction.captured,
            extraction.rejected,
            published.created,
            published.updated,
            published.unchanged,
            published.retired,
            now(),
          ],
        )
        return published
      })
      runLogger.info('sincronização concluída', {
        checksum,
        documents: fetched.length,
        captured: extraction.captured,
        rejected: extraction.rejected,
        ...counts,
      })
      return { sourceId: source.id, status: 'succeeded', runId: run.id }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await database.query(
        `UPDATE catalog_sync.sync_runs SET status = 'failed', error = $2, finished_at = $3 WHERE id = $1`,
        [run.id, message.slice(0, 2000), now()],
      )
      runLogger.error('sincronização falhou', { error })
      return { sourceId: source.id, status: 'failed', runId: run.id }
    }
  } finally {
    await releaseLock(database, source.id, holder)
  }
}

export async function runSources(
  sources: readonly Source[],
  options: { trigger: Trigger; force: boolean },
  dependencies: RunnerDependencies,
): Promise<RunOutcome[]> {
  const outcomes: RunOutcome[] = []
  for (const source of sources) outcomes.push(await runSource(source, options, dependencies))
  return outcomes
}
