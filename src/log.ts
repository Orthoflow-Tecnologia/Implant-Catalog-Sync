export const logLevels = ['error', 'warn', 'info', 'debug', 'silent'] as const
export type LogLevel = (typeof logLevels)[number]

type Fields = Record<string, unknown>
type WritableLevel = Exclude<LogLevel, 'silent'>

const severity: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3, silent: -1 }

export type Logger = {
  [Level in WritableLevel]: (message: string, fields?: Fields) => void
} & {
  child(fields: Fields): Logger
}

function serializable(value: unknown): unknown {
  if (value instanceof Error) return { name: value.name, message: value.message }
  return value
}

// Uma linha JSON por evento: o Railway indexa os campos e permite filtrar por source/runId.
export function createLogger(
  level: LogLevel,
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
  base: Fields = {},
): Logger {
  const emit = (entryLevel: WritableLevel, message: string, fields: Fields = {}): void => {
    if (severity[entryLevel] > severity[level]) return
    const entry: Fields = { time: new Date().toISOString(), level: entryLevel, message, ...base }
    for (const [key, value] of Object.entries(fields)) entry[key] = serializable(value)
    write(JSON.stringify(entry))
  }
  return {
    error: (message, fields) => emit('error', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    info: (message, fields) => emit('info', message, fields),
    debug: (message, fields) => emit('debug', message, fields),
    child: (fields) => createLogger(level, write, { ...base, ...fields }),
  }
}
