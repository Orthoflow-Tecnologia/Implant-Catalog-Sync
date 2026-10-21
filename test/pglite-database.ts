import { PGlite } from '@electric-sql/pglite'
import type { Database, Session, SqlRow } from '../src/db/database.js'

export class PgliteDatabase implements Database {
  constructor(private readonly db: PGlite) {}

  static async create(): Promise<PgliteDatabase> {
    return new PgliteDatabase(new PGlite())
  }

  async query<T extends SqlRow = SqlRow>(text: string, params: readonly unknown[] = []): Promise<T[]> {
    const result = await this.db.query<T>(text, [...params])
    return result.rows
  }

  async exec(text: string): Promise<void> {
    await this.db.exec(text)
  }

  async transaction<T>(run: (tx: Session) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) =>
      run({
        async query<TRow extends SqlRow = SqlRow>(text: string, params: readonly unknown[] = []) {
          const result = await tx.query<TRow>(text, [...params])
          return result.rows
        },
        async exec(text: string) {
          await tx.exec(text)
        },
      }),
    )
  }

  async close(): Promise<void> {
    await this.db.close()
  }
}
