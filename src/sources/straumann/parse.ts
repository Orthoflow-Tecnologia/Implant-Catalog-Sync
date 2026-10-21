import type { ImplantItem } from '../../catalog/items.js'
import type { PdfCell, PdfLine } from '../../pdf/lines.js'

export const straumannHolders = ['00489050000184']

const reference = /^0\d{2}\.\d{4}S?$/
const sectionNumber = /^\d{1,2}\.\d{1,2}(?:\.\d{1,2})?$/
const section = /^(BLC|BLX|TLC|TLX) Implants (SLActive|SLA)®?$/
const article = /^Straumann (BLC|BLX|TLC|TLX)™ (?:(SP|S) )?[Ii]mplants?$/
const dimensions = /^∅\s?(\d+(?:\.\d+)?)\s?(?:mm)?\s?(RB|WB|NT|RT|WT),?\s?(SLActive|SLA)®?\s(\d+(?:\.\d+)?)\s?mm$/

type Article = { page: number; y: number; line: string; variant: string | null }

function articlesOf(lines: readonly PdfLine[]): Article[] {
  return lines.flatMap((line) =>
    line.cells.flatMap((cell) => {
      const match = article.exec(cell.text)
      return match?.[1] ? [{ page: line.page, y: line.y, line: match[1], variant: match[2] ?? null }] : []
    }),
  )
}

// A coluna "Article" aparece centralizada em grupos de linhas; vale o rótulo mais próximo na mesma página.
function articleFor(articles: readonly Article[], line: PdfLine): Article | null {
  let best: Article | null = null
  for (const candidate of articles) {
    if (candidate.page !== line.page) continue
    if (!best || Math.abs(candidate.y - line.y) < Math.abs(best.y - line.y)) best = candidate
  }
  return best
}

export function parseStraumann(lines: readonly PdfLine[], documentUrl: string): { items: ImplantItem[]; rejected: number } {
  const articles = articlesOf(lines)
  const items: ImplantItem[] = []
  let rejected = 0
  let current: { line: string; surface: string } | null = null

  for (const line of lines) {
    const [numbering, name] = line.cells
    if (numbering && name && sectionNumber.test(numbering.text)) {
      const heading = section.exec(name.text)
      current = heading?.[1] && heading[2] ? { line: heading[1], surface: heading[2] } : null
      continue
    }
    const referenceCell = line.cells.find((cell: PdfCell) => reference.test(cell.text))
    if (!referenceCell || !current) continue

    const description = line.cells.map((cell) => dimensions.exec(cell.text)).find((match) => match !== null)
    const owner = articleFor(articles, line)
    if (!description?.[1] || !description[2] || !description[3] || !description[4] || !owner) {
      rejected += 1
      continue
    }
    if (owner.line !== current.line || description[3] !== current.surface) {
      rejected += 1
      continue
    }
    const model = [current.line, owner.variant, description[2], current.surface].filter((part) => part !== null).join(' ')
    items.push({
      kind: 'implant',
      manufacturer: 'Straumann',
      model,
      reference: referenceCell.text,
      diameterMm: Number(description[1]),
      lengthMm: Number(description[4]),
      anvisaHolders: straumannHolders,
      anvisaNames: [current.line],
      documentUrl,
      page: line.page,
    })
  }
  return { items, rejected }
}
