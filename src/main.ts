import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { parseArgs } from 'node:util'
import { ConfigError, loadConfig } from './config.js'
import { migrate } from './db/migrate.js'
import { PgDatabase } from './db/pg-database.js'
import { createDownloader } from './http/download.js'
import { createLogger } from './log.js'
import { sources as registry } from './sources/index.js'
import { runSources } from './sync/runner.js'

const { values } = parseArgs({
  options: {
    source: { type: 'string', multiple: true },
    force: { type: 'boolean', default: false },
  },
})

const config = loadConfig()
const logger = createLogger(config.logLevel)

const requested = [...(values.source ?? []).flatMap((id) => id.split(',')), ...(config.sources ?? [])]
  .map((id) => id.trim().toLowerCase())
  .filter((id) => id.length > 0)
const unknown = requested.filter((id) => !registry.some((source) => source.id === id))
if (unknown.length > 0) {
  throw new ConfigError(`Fontes desconhecidas: ${unknown.join(', ')}. Disponíveis: ${registry.map((source) => source.id).join(', ')}.`)
}
const selected = requested.length === 0 ? registry : registry.filter((source) => requested.includes(source.id))

const database = new PgDatabase(config.databaseUrl, (error) =>
  logger.warn('conexão ociosa com o banco encerrada; o pool abrirá outra', { error }),
)
try {
  const applied = await migrate(database)
  if (applied.length > 0) logger.info('migrations aplicadas', { applied })

  const outcomes = await runSources(
    selected,
    { trigger: values.force ? 'manual' : 'schedule', force: values.force },
    {
      database,
      download: createDownloader(config.http),
      logger,
      holder: `${hostname()}:${process.pid}:${randomUUID()}`,
      lockLeaseMinutes: config.lockLeaseMinutes,
      maxDropRatio: config.maxDropRatio,
      intervalHours: (source) => config.intervalHours[source.id] ?? source.defaultIntervalHours,
    },
  )
  logger.info('ciclo encerrado', { outcomes })
  if (outcomes.some((outcome) => outcome.status === 'failed')) process.exitCode = 1
} finally {
  await database.close()
}
