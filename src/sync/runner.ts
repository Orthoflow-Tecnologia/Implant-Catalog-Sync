import { createHash, randomUUID } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import type { Database } from '../db/database.js'
import type { Downloaded, Downloader } from '../http/download.js'
import type { Logger } from '../log.js'
import type { Source } from './source.js'

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

type Baseline = { id: string; checksum: string; etag: string | null; last_modified: string | null }

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
  const [row] = await database.query<Baseline>(
    `SELECT r.id, r.checksum, r.etag, r.last_modified
     FROM catalog_sync.sync_runs s
     JOIN catalog_sync.source_records r ON r.id = s.source_record_id
     WHERE s.source_id = $1 AND s.status IN ('succeeded', 'unchanged')
     ORDER BY s.started_at DESC
     LIMIT 1`,
    [sourceId],
  )
  return row ?? null
}

async function storeSourceRecord(
  database: Database,
  source: Source,
  downloaded: Downloaded,
  checksum: string,
  now: Date,
): Promise<string> {
  const [row] = await database.query<{ id: string }>(
    `INSERT INTO catalog_sync.source_records
       (source_id, url, license, checksum, etag, last_modified, content_type, byte_size, payload_gzip, first_fetched_at, last_fetched_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
     ON CONFLICT (source_id, checksum) DO UPDATE SET
       last_fetched_at = EXCLUDED.last_fetched_at,
       etag = EXCLUDED.etag,
       last_modified = EXCLUDED.last_modified
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
      gzipSync(downloaded.body),
      now,
    ],
  )
  if (!row) throw new Error('Falha ao registrar o payload bruto.')
  return row.id
}

async function finishUnchanged(database: Database, runId: string, sourceRecordId: string, now: Date): Promise<void> {
  await database.query(
    `UPDATE catalog_sync.sync_runs SET status = 'unchanged', source_record_id = $2, finished_at = $3 WHERE id = $1`,
    [runId, sourceRecordId, now],
  )
}

export async function runSource(
  source: Source,
  options: { trigger: Trigger; force: boolean },
  dependencies: RunnerDependencies,
): Promise<RunOutcome> {
  const { database, logger: baseLogger, holder } = dependencies
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
      const baseline = await baselineFor(database, source.id)
      const result = await dependencies.download({
        url: source.url,
        allowedHosts: source.allowedHosts,
        contentTypes: source.contentTypes,
        etag: options.force ? null : (baseline?.etag ?? null),
        lastModified: options.force ? null : (baseline?.last_modified ?? null),
      })

      if (result.status === 'not-modified') {
        if (!baseline) throw new Error('Fonte respondeu 304 sem payload anterior registrado.')
        await finishUnchanged(database, run.id, baseline.id, now())
        runLogger.info('fonte sem alterações (HTTP 304)')
        return { sourceId: source.id, status: 'unchanged', runId: run.id }
      }

      const checksum = createHash('sha256').update(result.body).digest('hex')
      const sourceRecordId = await storeSourceRecord(database, source, result, checksum, now())
      if (!options.force && baseline?.checksum === checksum) {
        await finishUnchanged(database, run.id, sourceRecordId, now())
        runLogger.info('payload idêntico ao último publicado', { checksum })
        return { sourceId: source.id, status: 'unchanged', runId: run.id }
      }

      const extraction = source.extract(result.body)
      const previous = await source.countPublished(database)
      if (previous > 0 && extraction.captured < previous * (1 - dependencies.maxDropRatio)) {
        throw new SuspiciousDropError(previous, extraction.captured)
      }

      const counts = await database.transaction(async (tx) => {
        const published = await extraction.publish(tx, { runId: run.id, now: startedAt })
        await tx.query(
          `UPDATE catalog_sync.sync_runs SET
             status = 'succeeded', source_record_id = $2, captured = $3, rejected = $4,
             created = $5, updated = $6, unchanged = $7, retired = $8, finished_at = $9
           WHERE id = $1`,
          [
            run.id,
            sourceRecordId,
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
