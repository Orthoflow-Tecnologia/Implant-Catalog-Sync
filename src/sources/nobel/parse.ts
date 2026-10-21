import type { ImplantItem } from '../../catalog/items.js'
import type { PdfCell, PdfLine } from '../../pdf/lines.js'

export const nobelHolders = ['84683556000110']

const surfaceHeader = /^(TiUltra|TiUnite)[¹²]?$/
const pmc = /^PMC[¹²]?$/
const length = /^(\d{1,2}(?:\.\d)?)mm$/
const reference = /^(\d{5,6})[¹²†]?$/
const diameter = /^\d\.\d{1,2}$/
const columnTolerance = 12
const labelReach = { min: 10, max: 70 }

type Column = { x: number; surface: string }
type Row = { y: number; length: PdfCell; references: { column: Column; value: string }[]; complete: boolean }

function clean(text: string): string {
  return text.replace(/[®™]/g, '').replace(/\s+/g, ' ').trim()
}

// O título fica na página de apresentação, alinhado à esquerda no alto: "Nobel Biocare / N1™ system", "NobelParallel™ / Conical Connection".
export function modelName(titleLines: readonly string[]): string {
  return clean(titleLines.join(' '))
    .replace(/^Nobel Biocare\s+/, '')
    .replace(/Conical Connection/g, 'CC')
    .replace(/\(PMC\)/g, '')
    .replace(/\bsystem\b/gi, '')
    .replace(/\b(TiUnite|TiUltra)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isTitleLine(line: PdfLine): boolean {
  const [cell] = line.cells
  return line.cells.length === 1 && cell !== undefined && cell.x >= 45 && cell.x <= 55 && line.y >= 595 && line.y <= 680
}

function columnsOf(header: PdfLine, next: PdfLine | undefined): Column[] {
  const columns = header.cells.flatMap((cell) => {
    const match = surfaceHeader.exec(cell.text)
    return match?.[1] ? [{ x: cell.x, surface: match[1] }] : []
  })
  const variants = next?.cells.filter((cell) => pmc.test(cell.text)) ?? []
  return columns.map((column) =>
    variants.some((cell) => Math.abs(cell.x - column.x) <= columnTolerance) ? { ...column, surface: `${column.surface} PMC` } : column,
  )
}

function rowOf(line: PdfLine, columns: readonly Column[]): Row | null {
  const firstColumn = Math.min(...columns.map((column) => column.x))
  const lengthCell = line.cells.find((cell) => cell.x < firstColumn && length.test(cell.text))
  if (!lengthCell) return null
  const references: Row['references'] = []
  let complete = true
  for (const column of columns) {
    const cell = line.cells.find((candidate) => Math.abs(candidate.x - column.x) <= columnTolerance)
    const value = cell ? reference.exec(cell.text)?.[1] : undefined
    if (value) references.push({ column, value })
    else if (cell && cell.text !== '-') complete = false
  }
  return { y: line.y, length: lengthCell, references, complete }
}

function groupsOf(rows: readonly Row[]): Row[][] {
  const groups: Row[][] = []
  let previous = Number.POSITIVE_INFINITY
  for (const row of rows) {
    const value = Number(length.exec(row.length.text)?.[1])
    const group = groups.at(-1)
    if (!group || value <= previous) groups.push([row])
    else group.push(row)
    previous = value
  }
  return groups
}

// O diâmetro aparece uma vez por grupo de comprimentos, centralizado na vertical à esquerda da coluna de comprimento.
function diameterOf(group: readonly Row[], page: readonly PdfLine[]): number | null {
  const top = Math.max(...group.map((row) => row.y)) + 4
  const bottom = Math.min(...group.map((row) => row.y)) - 4
  const lengthX = Math.min(...group.map((row) => row.length.x))
  const labels = page.flatMap((line) =>
    line.y <= top && line.y >= bottom
      ? line.cells.filter(
          (cell) => diameter.test(cell.text) && lengthX - cell.x >= labelReach.min && lengthX - cell.x <= labelReach.max,
        )
      : [],
  )
  const [label] = labels
  return labels.length === 1 && label ? Number(label.text) : null
}

export function parseNobel(lines: readonly PdfLine[], documentUrl: string): { items: ImplantItem[]; rejected: number } {
  const pages = new Map<number, PdfLine[]>()
  for (const line of lines) pages.set(line.page, [...(pages.get(line.page) ?? []), line])

  const items: ImplantItem[] = []
  let rejected = 0
  let title: string[] = []
  for (const [, page] of [...pages].sort(([a], [b]) => a - b)) {
    const titleLines = page.filter(isTitleLine)
    if (titleLines.length > 0) title = titleLines.map((line) => line.text)
    if (!page.some((line) => line.cells.some((cell) => cell.text === 'Art. no.'))) continue

    const headerIndex = page.findIndex((line) => line.cells.some((cell) => surfaceHeader.test(cell.text)))
    const header = page[headerIndex]
    if (!header) continue
    const columns = columnsOf(header, page[headerIndex + 1])
    const rows = page
      .slice(headerIndex + 1)
      .map((line) => rowOf(line, columns))
      .filter((row) => row !== null)
    const family = modelName(title)

    for (const group of groupsOf(rows)) {
      const diameterMm = diameterOf(group, page)
      const references = group.reduce((total, row) => total + row.references.length, 0)
      if (diameterMm === null || family === '' || group.some((row) => !row.complete)) {
        rejected += references
        continue
      }
      for (const row of group) {
        for (const { column, value } of row.references) {
          const model = `${family} ${column.surface}`
          items.push({
            kind: 'implant',
            manufacturer: 'Nobel Biocare',
            model,
            reference: value,
            diameterMm,
            lengthMm: Number(length.exec(row.length.text)?.[1]),
            anvisaHolders: nobelHolders,
            anvisaNames: [...new Set([model, family, family.split(' ')[0] ?? family, column.surface.replace(' PMC', '')])],
            documentUrl,
            page: header.page,
          })
        }
      }
    }
  }
  return { items, rejected }
}
