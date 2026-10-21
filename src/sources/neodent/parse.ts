import type { CatalogItem, ImplantItem } from '../../catalog/items.js'
import type { PdfCell, PdfLine } from '../../pdf/lines.js'

export const neodentHolders = ['00489050000184']

const reference = /^(?:140|109|180)\.\d{3,4}$/
const repeatedReference = /^((?:140|109|180)\.\d{3,4})\1$/
const concatenatedReferences = /^(?:(?:140|109|180)\.\d{3,4}){2,}$/
const rowLength = /^\d{1,2},\d$/
const headerLength = /^(\d{1,2}(?:,\d)?)\s?mm$/
const diameterLabel = /^(?:Ø\s?)?(\d,\d{1,2})$/
const explicitDiameter = /^Ø\s?\d,\d{1,2}$/
const surfaces = new Map([
  ['acqua', 'Acqua'],
  ['neoporos', 'NeoPoros'],
])
const columnTolerance = 15
const labelTolerance = 12
const title = /^Implantes(?=[A-Z])(.+)$/

type Table = { family: string; page: number; lines: PdfLine[] }
type Resolved = { diameterMm: number; lengthMm: number; surface: string | null }

function number(text: string): number {
  return Number(text.replace(',', '.'))
}

function clean(text: string): string {
  return text.replace(/[®™]/g, '').replace(/\s+/g, ' ').trim()
}

function surfaceOf(text: string): string | null {
  return surfaces.get(clean(text).toLowerCase()) ?? null
}

function referenceOf(text: string): string | 'ambiguous' | null {
  if (reference.test(text)) return text
  const repeated = repeatedReference.exec(text)
  if (repeated?.[1]) return repeated[1]
  return concatenatedReferences.test(text) ? 'ambiguous' : null
}

function familyOf(heading: string): string {
  return clean(heading.replace(/Ø\s?\d+,\d+/g, ''))
}

// Cada tabela começa num título "Implantes<Família>" e vai até o próximo título ou o fim da página.
export function tablesOf(lines: readonly PdfLine[]): Table[] {
  const tables: Table[] = []
  let current: Table | null = null
  for (const line of lines) {
    const heading = title.exec(line.text)
    if (heading?.[1]) {
      current = { family: familyOf(heading[1]), page: line.page, lines: [] }
      tables.push(current)
      continue
    }
    if (current && line.page !== current.page) current = null
    current?.lines.push(line)
  }
  return tables
}

function nearest(cells: readonly PdfCell[], x: number, tolerance: number): PdfCell | null {
  let best: PdfCell | null = null
  for (const cell of cells) {
    if (Math.abs(cell.x - x) > tolerance) continue
    if (!best || Math.abs(cell.x - x) < Math.abs(best.x - x)) best = cell
  }
  return best
}

function lastAtOrLeft(cells: readonly PdfCell[], x: number, tolerance: number): PdfCell | null {
  let best: PdfCell | null = null
  for (const cell of cells) {
    if (cell.x <= x + tolerance && (!best || cell.x > best.x)) best = cell
  }
  return best
}

export function parseTable(table: Table, documentUrl: string): { items: ImplantItem[]; rejected: number } {
  const items: ImplantItem[] = []
  let rejected = 0
  let lengthHeader: PdfCell[] = []
  let columnHeader: PdfCell[] = []
  let labels: PdfCell[] = []
  let previous: 'columns' | 'labels' | null = null

  for (const line of table.lines) {
    const references = line.cells.flatMap((cell) => {
      const value = referenceOf(cell.text)
      return value ? [{ cell, value }] : []
    })

    if (references.length === 0) {
      const lengths = line.cells.filter((cell) => headerLength.test(cell.text))
      const explicit = line.cells.filter((cell) => explicitDiameter.test(cell.text))
      const hasSurface = line.cells.some((cell) => surfaceOf(cell.text) !== null)
      const bare = line.cells.filter((cell) => cell.text !== 'Ø')
      const labelCells = bare.length > 0 && bare.every((cell) => diameterLabel.test(cell.text)) ? bare : explicit
      if (lengths.length >= 2) {
        lengthHeader = lengths
        previous = null
      } else if (explicit.length > 0 && (hasSurface || previous === 'columns')) {
        columnHeader = previous === 'columns' ? [...columnHeader, ...line.cells] : [...line.cells]
        previous = 'columns'
      } else if (labelCells.length > 0) {
        labels = previous === 'labels' ? [...labels, ...labelCells] : labelCells
        previous = 'labels'
      } else if (bare.length > 0) {
        previous = null
      }
      continue
    }
    previous = null

    const resolved: (Resolved & { reference: string })[] = []
    let failed = false
    for (const { cell, value } of references) {
      if (value === 'ambiguous') {
        failed = true
        break
      }
      const anchor = lastAtOrLeft(
        line.cells.filter((candidate) => candidate.x < cell.x && referenceOf(candidate.text) === null),
        cell.x,
        0,
      )
      const result = anchor && rowLength.test(anchor.text) ? byColumns(anchor, cell, columnHeader) : byRows(anchor, cell, lengthHeader, labels)
      if (!result) {
        failed = true
        break
      }
      resolved.push({ ...result, reference: value })
    }
    if (failed) {
      rejected += references.length
      continue
    }
    for (const entry of resolved) {
      const model = entry.surface ? `${table.family} ${entry.surface}` : table.family
      items.push({
        kind: 'implant',
        manufacturer: 'Neodent',
        model,
        reference: entry.reference,
        diameterMm: entry.diameterMm,
        lengthMm: entry.lengthMm,
        anvisaHolders: neodentHolders,
        anvisaNames: entry.surface ? [model, table.family] : [model],
        documentUrl,
        page: table.page,
      })
    }
  }
  return { items, rejected }
}

// Tabela com o diâmetro e a superfície no cabeçalho de colunas e o comprimento no início de cada linha (Helix GM, Helix HE).
function byColumns(length: PdfCell, cell: PdfCell, header: readonly PdfCell[]): Resolved | null {
  const diameters = header.filter((candidate) => explicitDiameter.test(candidate.text))
  const diameter = lastAtOrLeft(diameters, cell.x, 5)
  if (!diameter) return null
  const surfaceCells = header.filter((candidate) => surfaceOf(candidate.text) !== null)
  const surfaceCell = surfaceCells.length > 0 ? nearest(surfaceCells, cell.x, columnTolerance) : null
  if (surfaceCells.length > 0 && !surfaceCell) return null
  return {
    diameterMm: number(diameter.text.replace(/^Ø\s?/, '')),
    lengthMm: number(length.text),
    surface: surfaceCell ? surfaceOf(surfaceCell.text) : null,
  }
}

// Tabela com comprimentos no cabeçalho, rótulo de diâmetro acima do bloco e a superfície no início da linha (Drive GM, Titamax, Zygoma).
function byRows(anchor: PdfCell | null, cell: PdfCell, lengths: readonly PdfCell[], labels: readonly PdfCell[]): Resolved | null {
  const length = nearest(lengths, cell.x, columnTolerance)
  if (!length) return null
  const lengthText = headerLength.exec(length.text)?.[1]
  if (!lengthText) return null

  let surface: string | null = null
  let diameterText: string | null = null
  if (anchor) {
    const combined = /^Ø\s?(\d,\d{1,2})\s?\/\s?(.+)$/.exec(anchor.text)
    if (combined?.[1] && combined[2]) {
      diameterText = combined[1]
      surface = surfaceOf(combined[2])
    } else {
      surface = surfaceOf(anchor.text)
    }
    if (!surface) return null
  }
  if (!diameterText) {
    const label = lastAtOrLeft(labels, anchor?.x ?? cell.x, labelTolerance)
    diameterText = label ? (diameterLabel.exec(label.text)?.[1] ?? null) : null
  }
  if (!diameterText) return null
  return { diameterMm: number(diameterText), lengthMm: number(lengthText), surface }
}

export function parseNeodent(lines: readonly PdfLine[], documentUrl: string): { items: CatalogItem[]; rejected: number } {
  const items: CatalogItem[] = []
  let rejected = 0
  for (const table of tablesOf(lines)) {
    const parsed = parseTable(table, documentUrl)
    items.push(...parsed.items)
    rejected += parsed.rejected
  }
  return { items, rejected }
}
