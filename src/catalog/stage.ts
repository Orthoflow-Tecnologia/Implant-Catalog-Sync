import { createHash } from 'node:crypto'
import type { Session } from '../db/database.js'
import type { VersionContext, PublishCounts } from '../sync/source.js'
import type { CatalogItem } from './items.js'

type Existing = { id: string; reference: string; content_hash: string; in_source: boolean }

function contentHash(item: CatalogItem): string {
  return createHash('sha256').update(JSON.stringify(item)).digest('hex')
}

async function recordVersion(
  tx: Session,
  itemId: string,
  change: 'created' | 'updated' | 'retired' | 'restored',
  hash: string,
  data: unknown,
  context: VersionContext,
): Promise<void> {
  await tx.query(
    `INSERT INTO catalog_sync.catalog_item_versions (catalog_item_id, run_id, change, content_hash, data, recorded_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [itemId, context.runId, change, hash, JSON.stringify(data), context.now],
  )
}

export async function stageItems(
  tx: Session,
  sourceId: string,
  items: readonly CatalogItem[],
  context: VersionContext,
): Promise<PublishCounts> {
  const existing = new Map(
    (
      await tx.query<Existing>(
        'SELECT id, reference, content_hash, in_source FROM catalog_sync.catalog_items WHERE source_id = $1',
        [sourceId],
      )
    ).map((row) => [row.reference, row]),
  )
  const counts: PublishCounts = { created: 0, updated: 0, unchanged: 0, retired: 0 }
  const untouched: string[] = []

  for (const item of items) {
    const hash = contentHash(item)
    const current = existing.get(item.reference)
    existing.delete(item.reference)

    if (!current) {
      const [row] = await tx.query<{ id: string }>(
        `INSERT INTO catalog_sync.catalog_items
           (source_id, kind, manufacturer, model, reference, data, content_hash, first_seen_run_id, last_seen_run_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $8, $9, $9)
         RETURNING id`,
        [sourceId, item.kind, item.manufacturer, item.model, item.reference, JSON.stringify(item), hash, context.runId, context.now],
      )
      if (!row) throw new Error(`Falha ao inserir o item ${item.reference}.`)
      await recordVersion(tx, row.id, 'created', hash, item, context)
      counts.created += 1
      continue
    }

    if (current.content_hash === hash && current.in_source) {
      untouched.push(current.id)
      counts.unchanged += 1
      continue
    }

    await tx.query(
      `UPDATE catalog_sync.catalog_items SET
         kind = $2, manufacturer = $3, model = $4, data = $5::jsonb, content_hash = $6,
         in_source = true, last_seen_run_id = $7, updated_at = $8
       WHERE id = $1`,
      [current.id, item.kind, item.manufacturer, item.model, JSON.stringify(item), hash, context.runId, context.now],
    )
    await recordVersion(tx, current.id, current.in_source ? 'updated' : 'restored', hash, item, context)
    counts.updated += 1
  }

  if (untouched.length > 0) {
    await tx.query('UPDATE catalog_sync.catalog_items SET last_seen_run_id = $1 WHERE id = ANY($2::uuid[])', [
      context.runId,
      untouched,
    ])
  }

  for (const missing of existing.values()) {
    if (!missing.in_source) continue
    await tx.query('UPDATE catalog_sync.catalog_items SET in_source = false, updated_at = $2 WHERE id = $1', [
      missing.id,
      context.now,
    ])
    await recordVersion(tx, missing.id, 'retired', missing.content_hash, { reference: missing.reference }, context)
    counts.retired += 1
  }

  return counts
}
