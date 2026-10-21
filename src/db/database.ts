export type SqlRow = Record<string, unknown>

export interface Queryable {
  query<T extends SqlRow = SqlRow>(text: string, params?: readonly unknown[]): Promise<T[]>
}

export type Session = Queryable & { exec(text: string): Promise<void> }

export interface Database extends Session {
  transaction<T>(run: (tx: Session) => Promise<T>): Promise<T>
  close(): Promise<void>
}
