import type { Queryable, Session } from '../db/database.js'

export type PublishCounts = {
  created: number
  updated: number
  unchanged: number
  retired: number
}

export type PublishContext = {
  runId: string
  now: Date
}

export type Extraction = {
  captured: number
  rejected: number
  publish(tx: Session, context: PublishContext): Promise<PublishCounts>
}

export type Source = {
  id: string
  url: string
  allowedHosts: readonly string[]
  contentTypes: readonly string[]
  license: string
  defaultIntervalHours: number
  // Deve lançar erro quando o formato da fonte mudar: a execução falha e o catálogo publicado fica intacto.
  extract(payload: Buffer): Extraction
  countPublished(db: Queryable): Promise<number>
}
