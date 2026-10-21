import pg from 'pg'
import type { Database, Session, SqlRow } from './database.js'

function sessionFrom(client: pg.PoolClient): Session {
  return {
    async query<T extends SqlRow = SqlRow>(text: string, params: readonly unknown[] = []): Promise<T[]> {
      const result = await client.query<T>(text, [...params])
      return result.rows
    },
    async exec(text: string): Promise<void> {
      await client.query(text)
    },
  }
}

export class PgDatabase implements Database {
  private readonly pool: pg.Pool

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 4, application_name: 'implant-catalog-sync' })
  }

  async query<T extends SqlRow = SqlRow>(text: string, params: readonly unknown[] = []): Promise<T[]> {
    const result = await this.pool.query<T>(text, [...params])
    return result.rows
  }

  async exec(text: string): Promise<void> {
    await this.pool.query(text)
  }

  async transaction<T>(run: (tx: Session) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const value = await run(sessionFrom(client))
      await client.query('COMMIT')
      return value
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
