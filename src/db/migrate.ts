import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Database } from './database.js'

export function migrationsDirectory(): string {
  return join(new URL('../../migrations', import.meta.url).pathname)
}

// O banco pode ser compartilhado com a API do Implante Flow, que já usa public.schema_migrations.
export async function migrate(database: Database, directory = migrationsDirectory()): Promise<string[]> {
  await database.exec(`
    CREATE SCHEMA IF NOT EXISTS catalog_sync;
    CREATE TABLE IF NOT EXISTS catalog_sync.schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  const applied = new Set(
    (await database.query<{ id: string }>('SELECT id FROM catalog_sync.schema_migrations')).map((row) => row.id),
  )
  const files = readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  const ran: string[] = []

  for (const file of files) {
    if (applied.has(file)) continue
    const sql = readFileSync(join(directory, file), 'utf8')
    await database.transaction(async (tx) => {
      await tx.exec(sql)
      await tx.query('INSERT INTO catalog_sync.schema_migrations (id) VALUES ($1)', [file])
    })
    ran.push(file)
  }

  return ran
}
