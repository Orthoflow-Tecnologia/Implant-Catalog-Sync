import { logLevels, type LogLevel } from './log.js'

export type SyncConfig = {
  logLevel: LogLevel
  databaseUrl: string
  sources: readonly string[] | null
  intervalHours: Readonly<Record<string, number>>
  http: {
    timeoutMs: number
    maxBytes: number
    attempts: number
  }
  lockLeaseMinutes: number
  maxDropRatio: number
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

const intervalPrefix = 'SYNC_INTERVAL_HOURS_'

function read(source: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = source[key]
  if (value === undefined || value.trim() === '') return undefined
  return value.trim()
}

function isLogLevel(value: string): value is LogLevel {
  return logLevels.some((level) => level === value)
}

function positiveNumber(source: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = read(source, key)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) {
    throw new ConfigError(`${key} inválido. Use um número maior que zero.`)
  }
  return value
}

function positiveInteger(source: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const value = positiveNumber(source, key, fallback)
  if (!Number.isInteger(value)) throw new ConfigError(`${key} inválido. Use um inteiro maior que zero.`)
  return value
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): SyncConfig {
  const databaseUrl = read(source, 'DATABASE_URL')
  if (databaseUrl === undefined) throw new ConfigError('DATABASE_URL é obrigatório.')

  const logLevel = read(source, 'LOG_LEVEL') ?? 'info'
  if (!isLogLevel(logLevel)) throw new ConfigError(`LOG_LEVEL inválido. Use ${logLevels.join(', ')}.`)

  const sourcesRaw = read(source, 'SYNC_SOURCES')
  const sources = sourcesRaw
    ? sourcesRaw
        .split(',')
        .map((id) => id.trim().toLowerCase())
        .filter((id) => id.length > 0)
    : null

  const intervalHours: Record<string, number> = {}
  for (const key of Object.keys(source)) {
    if (!key.startsWith(intervalPrefix)) continue
    intervalHours[key.slice(intervalPrefix.length).toLowerCase()] = positiveNumber(source, key, 24)
  }

  const maxDropRatio = positiveNumber(source, 'SYNC_MAX_DROP_RATIO', 0.2)
  if (maxDropRatio >= 1) throw new ConfigError('SYNC_MAX_DROP_RATIO inválido. Use um valor entre 0 e 1.')

  return {
    logLevel,
    databaseUrl,
    sources,
    intervalHours,
    http: {
      timeoutMs: positiveInteger(source, 'HTTP_TIMEOUT_MS', 120_000),
      maxBytes: positiveInteger(source, 'HTTP_MAX_BYTES', 100 * 1024 * 1024),
      attempts: positiveInteger(source, 'HTTP_ATTEMPTS', 3),
    },
    lockLeaseMinutes: positiveInteger(source, 'SYNC_LOCK_LEASE_MINUTES', 60),
    maxDropRatio,
  }
}
