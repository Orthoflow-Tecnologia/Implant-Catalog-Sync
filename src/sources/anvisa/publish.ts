import { createHash } from 'node:crypto'
import type { Session } from '../../db/database.js'
import type { VersionContext, PublishCounts } from '../../sync/source.js'
import type { Registration } from './parse.js'

type Existing = { id: string; number: string; content_hash: string; in_source: boolean }

export function contentHash(registration: Registration): string {
  return createHash('sha256').update(JSON.stringify(registration)).digest('hex')
}

async function recordVersion(
  tx: Session,
  recordId: string,
  change: 'created' | 'updated' | 'retired' | 'restored',
  hash: string,
  data: unknown,
  context: VersionContext,
): Promise<void> {
  await tx.query(
    `INSERT INTO catalog_sync.regulatory_record_versions (regulatory_record_id, run_id, change, content_hash, data, recorded_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [recordId, context.runId, change, hash, JSON.stringify(data), context.now],
  )
}

function values(registration: Registration): unknown[] {
  return [
    registration.category,
    registration.processNumber,
    registration.technicalName,
    registration.riskClass,
    registration.commercialName,
    registration.holderCnpj,
    registration.holderName,
    JSON.stringify(registration.manufacturers),
    registration.publishedOn,
    registration.validUntil,
  ]
}

export async function publishRegistrations(
  tx: Session,
  registrations: readonly Registration[],
  context: VersionContext,
): Promise<PublishCounts> {
  const existing = new Map(
    (
      await tx.query<Existing>(
        `SELECT id, number, content_hash, in_source FROM catalog_sync.regulatory_records WHERE authority = 'ANVISA'`,
      )
    ).map((row) => [row.number, row]),
  )
  const counts: PublishCounts = { created: 0, updated: 0, unchanged: 0, retired: 0 }
  const untouched: string[] = []

  for (const registration of registrations) {
    const hash = contentHash(registration)
    const current = existing.get(registration.number)
    existing.delete(registration.number)

    if (!current) {
      const [row] = await tx.query<{ id: string }>(
        `INSERT INTO catalog_sync.regulatory_records
           (authority, number, category, process_number, technical_name, risk_class, commercial_name,
            holder_cnpj, holder_name, manufacturers, published_on, valid_until, content_hash,
            first_seen_run_id, last_seen_run_id, created_at, updated_at)
         VALUES ('ANVISA', $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::date, $11::date, $12, $13, $13, $14, $14)
         RETURNING id`,
        [registration.number, ...values(registration), hash, context.runId, context.now],
      )
      if (!row) throw new Error(`Falha ao inserir o registro ${registration.number}.`)
      await recordVersion(tx, row.id, 'created', hash, registration, context)
      counts.created += 1
      continue
    }

    if (current.content_hash === hash && current.in_source) {
      untouched.push(current.id)
      counts.unchanged += 1
      continue
    }

    await tx.query(
      `UPDATE catalog_sync.regulatory_records SET
         category = $2, process_number = $3, technical_name = $4, risk_class = $5, commercial_name = $6,
         holder_cnpj = $7, holder_name = $8, manufacturers = $9::jsonb, published_on = $10::date, valid_until = $11::date,
         content_hash = $12, in_source = true, last_seen_run_id = $13, updated_at = $14
       WHERE id = $1`,
      [current.id, ...values(registration), hash, context.runId, context.now],
    )
    await recordVersion(tx, current.id, current.in_source ? 'updated' : 'restored', hash, registration, context)
    counts.updated += 1
  }

  if (untouched.length > 0) {
    await tx.query(`UPDATE catalog_sync.regulatory_records SET last_seen_run_id = $1 WHERE id = ANY($2::uuid[])`, [
      context.runId,
      untouched,
    ])
  }

  for (const missing of existing.values()) {
    if (!missing.in_source) continue
    await tx.query(`UPDATE catalog_sync.regulatory_records SET in_source = false, updated_at = $2 WHERE id = $1`, [
      missing.id,
      context.now,
    ])
    await recordVersion(tx, missing.id, 'retired', missing.content_hash, { number: missing.number }, context)
    counts.retired += 1
  }

  return counts
}
