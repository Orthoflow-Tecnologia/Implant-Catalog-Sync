import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ConfigError, loadConfig } from '../src/config.js'

test('exige DATABASE_URL e aplica padrões', () => {
  assert.throws(() => loadConfig({}), ConfigError)
  const config = loadConfig({ DATABASE_URL: 'postgres://localhost/db' })
  assert.equal(config.logLevel, 'info')
  assert.equal(config.sources, null)
  assert.equal(config.maxDropRatio, 0.2)
  assert.deepEqual(config.http, { timeoutMs: 120_000, maxBytes: 100 * 1024 * 1024, attempts: 3 })
})

test('lê fontes e intervalos por fonte', () => {
  const config = loadConfig({
    DATABASE_URL: 'postgres://localhost/db',
    SYNC_SOURCES: 'ANVISA, neodent',
    SYNC_INTERVAL_HOURS_ANVISA: '12',
  })
  assert.deepEqual(config.sources, ['anvisa', 'neodent'])
  assert.deepEqual(config.intervalHours, { anvisa: 12 })
})

test('recusa valores inválidos', () => {
  const base = { DATABASE_URL: 'postgres://localhost/db' }
  assert.throws(() => loadConfig({ ...base, LOG_LEVEL: 'verbose' }), /LOG_LEVEL/)
  assert.throws(() => loadConfig({ ...base, SYNC_MAX_DROP_RATIO: '1' }), /SYNC_MAX_DROP_RATIO/)
  assert.throws(() => loadConfig({ ...base, HTTP_ATTEMPTS: '1.5' }), /HTTP_ATTEMPTS/)
  assert.throws(() => loadConfig({ ...base, SYNC_INTERVAL_HOURS_ANVISA: '0' }), /SYNC_INTERVAL_HOURS_ANVISA/)
})
