export type Provenance = {
  documentUrl: string
  page: number | null
}

// anvisaNames: nomes, em ordem de preferência, que identificam o registro do item na ANVISA (modelo, família, superfície).
type Common = Provenance & {
  manufacturer: string
  model: string
  reference: string
  anvisaHolders: readonly string[]
  anvisaNames: readonly string[]
}

export type ImplantItem = Common & {
  kind: 'implant'
  diameterMm: number
  lengthMm: number
}

export type GraftPresentation = 'bloco' | 'po'

export type GraftItem = Common & {
  kind: 'graft'
  productType: string
  presentation: GraftPresentation
  granulometry: string | null
  quantity: string | null
}

export type CatalogItem = ImplantItem | GraftItem

export type Parsed = {
  items: CatalogItem[]
  rejected: number
}

export class CatalogFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CatalogFormatError'
  }
}

const diameterRange = { min: 2.5, max: 8 }
const lengthRange = { min: 4, max: 60 }

function plausible(item: CatalogItem): boolean {
  if (item.reference.trim() === '' || item.model.trim() === '' || item.manufacturer.trim() === '') return false
  if (item.kind === 'graft') return true
  return (
    item.diameterMm >= diameterRange.min &&
    item.diameterMm <= diameterRange.max &&
    item.lengthMm >= lengthRange.min &&
    item.lengthMm <= lengthRange.max
  )
}

function sameProduct(a: CatalogItem, b: CatalogItem): boolean {
  return JSON.stringify({ ...a, documentUrl: '', page: null }) === JSON.stringify({ ...b, documentUrl: '', page: null })
}

// Referência repetida com dados divergentes vira rejeição das duas ocorrências: não há como escolher a correta.
export function consolidate(candidates: readonly CatalogItem[], rejectedUpstream: number): Parsed {
  const byReference = new Map<string, CatalogItem | null>()
  let rejected = rejectedUpstream
  for (const item of candidates) {
    if (!plausible(item)) {
      rejected += 1
      continue
    }
    const key = `${item.manufacturer}\u0000${item.reference}`
    const seen = byReference.get(key)
    if (seen === undefined) byReference.set(key, item)
    else if (seen !== null && !sameProduct(seen, item)) {
      byReference.set(key, null)
      rejected += 2
    } else if (seen === null) rejected += 1
  }
  const items = [...byReference.values()].filter((item) => item !== null)
  return { items, rejected }
}

export function requireMinimum(sourceId: string, parsed: Parsed, minimum: number): Parsed {
  if (parsed.items.length < minimum) {
    throw new CatalogFormatError(
      `Catálogo ${sourceId} rendeu ${parsed.items.length} itens (mínimo ${minimum}); o layout provavelmente mudou.`,
    )
  }
  return parsed
}
