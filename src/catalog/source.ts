import type { Session } from '../db/database.js'
import type { FetchPage, PublishContext, PublishCounts, Source, SourceDocument } from '../sync/source.js'
import { pdfLines, type PdfLine } from '../pdf/lines.js'
import { consolidate, requireMinimum, type CatalogItem, type Parsed } from './items.js'
import { projectAppCatalog } from './project.js'
import { stageItems } from './stage.js'

export async function publishWithProjection(
  tx: Session,
  context: PublishContext,
  publish: () => Promise<PublishCounts>,
): Promise<PublishCounts> {
  const counts = await publish()
  const projection = await projectAppCatalog(tx)
  if (projection) context.logger.info('catálogo do app atualizado', projection)
  else context.logger.warn('tabelas de catálogo do app ausentes; dados mantidos apenas no staging')
  return counts
}

export type CatalogSourceDefinition = {
  id: string
  allowedHosts: readonly string[]
  contentTypes?: readonly string[]
  license: string
  defaultIntervalHours?: number
  // Abaixo disso o layout do catálogo provavelmente mudou; a execução falha sem tocar no que está publicado.
  minimumItems: number
  locate(fetchPage: FetchPage): Promise<readonly string[]>
  parse(documents: readonly SourceDocument[]): Promise<Parsed>
}

export type PdfParser = (lines: readonly PdfLine[], document: SourceDocument) => { items: CatalogItem[]; rejected: number }

// Um PDF por vez: cada catálogo ocupa centenas de MB enquanto é lido.
export function parsePdfs(parse: PdfParser): (documents: readonly SourceDocument[]) => Promise<Parsed> {
  return async (documents) => {
    const items: CatalogItem[] = []
    let rejected = 0
    for (const document of documents) {
      const result = parse(await pdfLines(document.body), document)
      items.push(...result.items)
      rejected += result.rejected
    }
    return consolidate(items, rejected)
  }
}

export function catalogSource(definition: CatalogSourceDefinition): Source {
  return {
    id: definition.id,
    allowedHosts: definition.allowedHosts,
    contentTypes: definition.contentTypes ?? ['application/pdf', 'application/octet-stream'],
    license: definition.license,
    defaultIntervalHours: definition.defaultIntervalHours ?? 24 * 7,
    locate: definition.locate,
    async extract(documents) {
      const { items, rejected } = requireMinimum(definition.id, await definition.parse(documents), definition.minimumItems)
      return {
        captured: items.length,
        rejected,
        publish: (tx, context) => publishWithProjection(tx, context, () => stageItems(tx, definition.id, items, context)),
      }
    },
    async countPublished(db) {
      const [row] = await db.query<{ total: number }>(
        'SELECT count(*)::int AS total FROM catalog_sync.catalog_items WHERE source_id = $1 AND in_source',
        [definition.id],
      )
      return row?.total ?? 0
    },
  }
}
