import type { Session } from '../db/database.js'
import { createAnvisaLinker, type RegistrationName } from './anvisa-link.js'
import type { CatalogItem, GraftItem, ImplantItem } from './items.js'

export type Projection = {
  references: number
  linked: number
  retiredReferences: number
  graftModels: number
  retiredGraftModels: number
}

export function slug(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/(?<!\d)\.|\.(?!\d)/g, '')
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function formatMm(value: number, minimumDecimals: number): string {
  const text = String(value)
  return minimumDecimals > 0 && Number.isInteger(value) ? value.toFixed(minimumDecimals) : text
}

// Mesmo formato do seed do app: id "4.0x10", rótulo "4.0 × 10 mm".
export function sizeOf(item: ImplantItem): { id: string; label: string } {
  const diameter = formatMm(item.diameterMm, 1)
  const length = formatMm(item.lengthMm, 0)
  return { id: `${diameter}x${length}`, label: `${diameter} × ${length} mm` }
}

async function appCatalogReady(tx: Session): Promise<boolean> {
  const [row] = await tx.query<{ ready: boolean }>(
    `SELECT to_regclass('public.implant_references') IS NOT NULL AND to_regclass('public.graft_models') IS NOT NULL AS ready`,
  )
  return row?.ready === true
}

async function manufacturerId(tx: Session, table: 'implant_manufacturers' | 'graft_manufacturers', name: string): Promise<string> {
  const [existing] = await tx.query<{ id: string }>(`SELECT id FROM public.${table} WHERE lower(name) = lower($1)`, [name])
  if (existing) {
    await tx.query(`UPDATE public.${table} SET active = true WHERE id = $1 AND NOT active`, [existing.id])
    return existing.id
  }
  const [created] = await tx.query<{ id: string }>(
    `INSERT INTO public.${table} (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id`,
    [slug(name), name],
  )
  if (!created) throw new Error(`Fabricante "${name}" conflita com um id existente em ${table}.`)
  return created.id
}

async function own(tx: Session, table: 'implant_models' | 'implant_references' | 'graft_models', ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return
  await tx.query(
    `INSERT INTO catalog_sync.app_rows (table_name, row_id) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`,
    [table, ids],
  )
}

async function implantModelId(tx: Session, manufacturer: string, name: string): Promise<string> {
  const [existing] = await tx.query<{ id: string }>(
    'SELECT id FROM public.implant_models WHERE manufacturer_id = $1 AND name = $2',
    [manufacturer, name],
  )
  if (existing) return existing.id
  const [created] = await tx.query<{ id: string }>(
    `INSERT INTO public.implant_models (id, manufacturer_id, name) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING RETURNING id`,
    [slug(`${manufacturer}-${name}`), manufacturer, name],
  )
  if (!created) throw new Error(`Modelo "${name}" conflita com um id existente em implant_models.`)
  await own(tx, 'implant_models', [created.id])
  return created.id
}

async function projectImplants(
  tx: Session,
  items: readonly ImplantItem[],
  link: (item: CatalogItem) => string | null,
): Promise<Pick<Projection, 'references' | 'linked' | 'retiredReferences'>> {
  const manufacturers = new Map<string, string>()
  const models = new Map<string, string>()
  const sizes = new Map<string, string>()
  const rows: { manufacturer_id: string; model_id: string; reference: string; size_id: string; anvisa: string }[] = []
  let linked = 0

  for (const item of items) {
    let manufacturer = manufacturers.get(item.manufacturer)
    if (!manufacturer) {
      manufacturer = await manufacturerId(tx, 'implant_manufacturers', item.manufacturer)
      manufacturers.set(item.manufacturer, manufacturer)
    }
    const modelKey = `${manufacturer}\u0000${item.model}`
    let model = models.get(modelKey)
    if (!model) {
      model = await implantModelId(tx, manufacturer, item.model)
      models.set(modelKey, model)
    }
    const size = sizeOf(item)
    sizes.set(size.id, size.label)
    const anvisa = link(item) ?? ''
    if (anvisa !== '') linked += 1
    rows.push({ manufacturer_id: manufacturer, model_id: model, reference: item.reference, size_id: size.id, anvisa })
  }

  await tx.query(
    `INSERT INTO public.implant_sizes (id, label)
     SELECT id, label FROM unnest($1::text[], $2::text[]) AS s(id, label)
     ON CONFLICT (id) DO UPDATE SET active = true WHERE NOT public.implant_sizes.active`,
    [[...sizes.keys()], [...sizes.values()]],
  )

  const published = await tx.query<{ id: string }>(
    `INSERT INTO public.implant_references (id, manufacturer_id, model_id, reference, size_id, anvisa)
     SELECT x.manufacturer_id || '-' || regexp_replace(lower(x.reference), '[^a-z0-9.]+', '-', 'g'),
            x.manufacturer_id, x.model_id, x.reference, x.size_id, x.anvisa
     FROM jsonb_to_recordset($1::jsonb) AS x(manufacturer_id text, model_id text, reference text, size_id text, anvisa text)
     ON CONFLICT (manufacturer_id, reference) DO UPDATE SET
       model_id = EXCLUDED.model_id, size_id = EXCLUDED.size_id, anvisa = EXCLUDED.anvisa, active = true
     RETURNING id`,
    [JSON.stringify(rows)],
  )
  const publishedIds = published.map((row) => row.id)
  await own(tx, 'implant_references', publishedIds)

  const retired = await tx.query(
    `UPDATE public.implant_references r SET active = false
     FROM catalog_sync.app_rows o
     WHERE o.table_name = 'implant_references' AND o.row_id = r.id AND r.active AND NOT (r.id = ANY($1::text[]))
     RETURNING r.id`,
    [publishedIds],
  )
  await tx.query(
    `UPDATE public.implant_models m SET active = EXISTS (
       SELECT 1 FROM public.implant_references r WHERE r.model_id = m.id AND r.active
     )
     FROM catalog_sync.app_rows o
     WHERE o.table_name = 'implant_models' AND o.row_id = m.id`,
  )
  await tx.query(
    `UPDATE public.implant_models SET active = true WHERE id = ANY($1::text[]) AND NOT active`,
    [[...models.values()]],
  )
  return { references: publishedIds.length, linked, retiredReferences: retired.length }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
}

async function projectGrafts(tx: Session, items: readonly GraftItem[]): Promise<Pick<Projection, 'graftModels' | 'retiredGraftModels'>> {
  const groups = new Map<string, GraftItem[]>()
  for (const item of items) {
    const key = `${item.manufacturer}\u0000${item.model}`
    groups.set(key, [...(groups.get(key) ?? []), item])
  }

  const publishedIds: string[] = []
  const manufacturers = new Map<string, string>()
  for (const group of groups.values()) {
    const [first] = group
    if (!first) continue
    let manufacturer = manufacturers.get(first.manufacturer)
    if (!manufacturer) {
      manufacturer = await manufacturerId(tx, 'graft_manufacturers', first.manufacturer)
      manufacturers.set(first.manufacturer, manufacturer)
    }
    const presentations = unique(group.map((item) => item.presentation))
    const granulometries = unique(group.flatMap((item) => (item.granulometry ? [item.granulometry] : [])))
    const [row] = await tx.query<{ id: string }>(
      `INSERT INTO public.graft_models (id, manufacturer_id, name, product_type, presentations, granulometries)
       VALUES ($1, $2, $3, $4, $5::text[], $6::text[])
       ON CONFLICT (manufacturer_id, name) DO UPDATE SET
         product_type = EXCLUDED.product_type, presentations = EXCLUDED.presentations,
         granulometries = EXCLUDED.granulometries, active = true
       RETURNING id`,
      [slug(`${manufacturer}-${first.model}`), manufacturer, first.model, first.productType, presentations, granulometries],
    )
    if (!row) throw new Error(`Falha ao publicar o enxerto ${first.model}.`)
    publishedIds.push(row.id)
  }
  await own(tx, 'graft_models', publishedIds)

  const retired = await tx.query(
    `UPDATE public.graft_models g SET active = false
     FROM catalog_sync.app_rows o
     WHERE o.table_name = 'graft_models' AND o.row_id = g.id AND g.active AND NOT (g.id = ANY($1::text[]))
     RETURNING g.id`,
    [publishedIds],
  )
  return { graftModels: publishedIds.length, retiredGraftModels: retired.length }
}

// Reconstrói a parte do catálogo do app que pertence à sincronização a partir de todo o staging vigente.
// Sem as tabelas do app (banco só da sincronização), mantém apenas o staging.
export async function projectAppCatalog(tx: Session): Promise<Projection | null> {
  if (!(await appCatalogReady(tx))) return null
  const items = (
    await tx.query<{ data: CatalogItem }>(
      'SELECT data FROM catalog_sync.catalog_items WHERE in_source ORDER BY manufacturer, model, reference',
    )
  ).map((row) => row.data)
  const registrations = await tx.query<RegistrationName>(
    `SELECT number, category, holder_cnpj AS "holderCnpj", commercial_name AS "commercialName"
     FROM catalog_sync.regulatory_records WHERE authority = 'ANVISA' AND in_source`,
  )
  const link = createAnvisaLinker(registrations)
  const implants = await projectImplants(
    tx,
    items.filter((item) => item.kind === 'implant'),
    link,
  )
  const grafts = await projectGrafts(
    tx,
    items.filter((item) => item.kind === 'graft'),
  )
  return { ...implants, ...grafts }
}
