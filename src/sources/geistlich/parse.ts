import type { GraftItem, GraftPresentation } from '../../catalog/items.js'

export const geistlichHolders = ['11344677000163']

// Classificação da própria loja: os produtos vêm da categoria "Substitutos ósseos".
const productType = 'Substituto ósseo'

const models: readonly { pattern: RegExp; model: string }[] = [
  { pattern: /\bBio-Oss Pen\b/, model: 'Bio-Oss Pen' },
  { pattern: /\bBio-Oss Collagen\b/, model: 'Bio-Oss Collagen' },
  { pattern: /\bBio-Oss Block\b/, model: 'Bio-Oss Block' },
  { pattern: /\bBio-Oss (?:Small|Large)\b/, model: 'Bio-Oss' },
]

const entities: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&#039;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' }

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:amp|quot|#039|lt|gt|nbsp);/g, (entity) => entities[entity] ?? entity)
    .replace(/\s+/g, ' ')
    .trim()
}

interface Specification {
  quantity: string | null
  granulometry: string | null
  dimensions: string | null
}

// Tabela "Apresentação | Granulometria ou Dimensões | Volume" da página do produto.
function specificationOf(html: string): Specification | null {
  const table = /<table[\s\S]*?<\/table>/.exec(html)?.[0]
  if (!table) return null
  const rows = [...table.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((row) =>
    [...row[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((cell) => text(cell[1] ?? '')),
  )
  const [header, values, ...rest] = rows
  if (!header || !values || rest.length > 0 || header.length !== values.length) return null
  const column = (name: string) => {
    const index = header.indexOf(name)
    return index >= 0 ? (values[index] ?? null) : null
  }
  return { quantity: column('Apresentação'), granulometry: column('Granulometria'), dimensions: column('Dimensões') }
}

export type GeistlichResult = { item: GraftItem } | { rejected: string }

export function parseGeistlichProduct(html: string, documentUrl: string): GeistlichResult {
  const sku = /data-product-sku="([^"]+)"/.exec(html)?.[1]?.trim()
  const rawName = /<span[^>]*itemprop="name"[^>]*>([^<]+)</.exec(html)?.[1]
  if (!sku || !rawName) return { rejected: 'sem SKU ou nome' }
  const name = text(rawName).replace(/[®™]/g, '')
  const line = name.replace(/\bGeistlich\b/g, '').replace(/\s+/g, ' ')
  const model = models.find((candidate) => candidate.pattern.test(line))?.model
  if (!model) return { rejected: `linha desconhecida: ${name}` }

  const namedDimensions = /\((\d+(?:,\d+)?x\d+(?:,\d+)?x\d+(?:,\d+)?\s?cm)\)/.exec(name)?.[1] ?? null
  const specification = specificationOf(html) ?? (namedDimensions ? { quantity: namedDimensions, granulometry: null, dimensions: namedDimensions } : null)
  const granulometry = /^(\d+(?:,\d+)?)\s*[–-]\s*(\d+(?:,\d+)?)\s*mm$/.exec(specification?.granulometry ?? '')
  let presentation: GraftPresentation
  if (granulometry && !specification?.dimensions) presentation = 'po'
  else if (specification?.dimensions && !specification.granulometry) presentation = 'bloco'
  else return { rejected: `apresentação não identificada: ${name}` }

  return {
    item: {
      kind: 'graft',
      manufacturer: 'Geistlich',
      model,
      reference: sku,
      productType,
      presentation,
      granulometry: granulometry ? `${granulometry[1]}–${granulometry[2]} mm` : null,
      quantity: specification?.quantity ?? null,
      anvisaHolders: geistlichHolders,
      anvisaNames: [model],
      documentUrl,
      page: null,
    },
  }
}
