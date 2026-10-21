import type { Queryable, Session } from '../db/database.js'
import type { Logger } from '../log.js'

export type PublishCounts = {
  created: number
  updated: number
  unchanged: number
  retired: number
}

export type VersionContext = {
  runId: string
  now: Date
}

export type PublishContext = VersionContext & {
  logger: Logger
}

export type Extraction = {
  captured: number
  rejected: number
  publish(tx: Session, context: PublishContext): Promise<PublishCounts>
}

export type SourceDocument = {
  url: string
  body: Buffer
}

export type FetchPage = (url: string) => Promise<string>

export type Source = {
  id: string
  allowedHosts: readonly string[]
  contentTypes: readonly string[]
  license: string
  defaultIntervalHours: number
  // Lista os documentos da execução; fontes com índice (página de downloads, sitemap) descobrem as URLs a cada ciclo.
  locate(fetchPage: FetchPage): Promise<readonly string[]>
  // Deve lançar erro quando o formato da fonte mudar: a execução falha e o catálogo publicado fica intacto.
  extract(documents: readonly SourceDocument[]): Promise<Extraction>
  countPublished(db: Queryable): Promise<number>
}
