import type { ImplantItem } from '../../catalog/items.js'
import type { PdfCell, PdfLine } from '../../pdf/lines.js'

export const sinHolders = ['04298106000174']

const codeHeader = /^CÓD\.(?:\s+(.+))?$/
const code = /^[A-Z]{2,6} ?\d{3,5}[A-Z]?$/
const measure = /^\d{1,2}(?:[.,]\d{1,2})?$/
const columnTolerance = 10
const tableLeft = 120
const tabX = 1150

const connections: readonly [RegExp, (match: RegExpExecArray) => string][] = [
  [/^HEXÁGONO EXTERNO$/, () => 'HE'],
  [/^HEXÁGONO INTERNO$/, () => 'HI'],
  [/^CONE MORSE(?:\s+(\d+(?:,\d+)?)º)?$/, (match) => (match[1] ? `CM ${match[1]}°` : 'CM')],
]

function titleCase(text: string): string {
  return text.toLowerCase().replace(/(^|\s)\p{L}/gu, (letter) => letter.toUpperCase())
}

function variantOf(label: string | undefined): string | null {
  if (!label) return null
  return label
    .split(/\s+/)
    .map((word) => (word.length <= 2 ? word : titleCase(word)))
    .join(' ')
}

// A aba lateral da página traz a conexão ("HEXÁGONO EXTERNO") ou a sub-linha ("UNITITE SLIM").
function tabOf(page: readonly PdfLine[], line: string): { connection: string | null; subline: string | null } {
  for (const row of page) {
    for (const cell of row.cells) {
      if (cell.x < tabX) continue
      for (const [pattern, format] of connections) {
        const match = pattern.exec(cell.text)
        if (match) return { connection: format(match), subline: null }
      }
      const upper = line.toUpperCase()
      if (cell.text.startsWith(`${upper} `)) return { connection: null, subline: titleCase(cell.text.slice(upper.length + 1)) }
    }
  }
  return { connection: null, subline: null }
}

function columnOf(cells: readonly PdfCell[], x: number): PdfCell | undefined {
  return cells.find((cell) => Math.abs(cell.x - x) <= columnTolerance)
}

// Tabelas de componentes ficam lado a lado com a de implantes; vale o cabeçalho imediatamente à direita.
function closestRight(cells: readonly PdfCell[], x: number, accept: (cell: PdfCell) => boolean): PdfCell | undefined {
  return cells.filter((cell) => cell.x > x && accept(cell)).sort((a, b) => a.x - b.x)[0]
}

function measureOf(text: string): number {
  return Number(text.replace(',', '.'))
}

export function parseSin(lines: readonly PdfLine[], line: string, documentUrl: string): { items: ImplantItem[]; rejected: number } {
  const pages = new Map<number, PdfLine[]>()
  for (const row of lines) pages.set(row.page, [...(pages.get(row.page) ?? []), row])

  const items: ImplantItem[] = []
  let rejected = 0
  for (const [pageNumber, page] of pages) {
    const tab = tabOf(page, line)
    for (let index = 0; index < page.length; index += 1) {
      const header = page[index]
      const codeColumns = header?.cells.filter((cell) => cell.x < tableLeft && codeHeader.test(cell.text)) ?? []
      if (!header || codeColumns.length === 0) continue

      const nearby = page.filter((row) => Math.abs(row.y - header.y) <= 15).flatMap((row) => row.cells)
      const lastCode = Math.max(...codeColumns.map((column) => column.x))
      const diameterHeader = closestRight(nearby, lastCode, (cell) => cell.text === 'DIÂM.')
      const lengthHeader = diameterHeader
        ? closestRight(nearby, diameterHeader.x, (cell) => cell.text === 'COMP.' || cell.text === 'ALT.')
        : undefined
      if (!diameterHeader || !lengthHeader || lengthHeader.x - diameterHeader.x > 60) continue

      for (const row of page.slice(index + 1)) {
        if (row.cells.some((cell) => cell.x < tableLeft && codeHeader.test(cell.text))) break
        const diameterCell = columnOf(row.cells, diameterHeader.x)
        const lengthCell = columnOf(row.cells, lengthHeader.x)
        const codes = codeColumns.map((column) => ({ column, cell: columnOf(row.cells, column.x) }))
        if (!codes.some(({ cell }) => cell && code.test(cell.text))) continue

        if (!diameterCell || !lengthCell || !measure.test(diameterCell.text) || !measure.test(lengthCell.text)) {
          rejected += codes.filter(({ cell }) => cell && code.test(cell.text)).length
          continue
        }
        for (const { column, cell } of codes) {
          if (!cell || !code.test(cell.text)) continue
          const variant = variantOf(codeHeader.exec(column.text)?.[1])
          const family = [line, tab.subline, variant].filter((part) => part !== null).join(' ')
          const model = tab.connection ? `${family} ${tab.connection}` : family
          items.push({
            kind: 'implant',
            manufacturer: 'S.I.N.',
            model,
            reference: cell.text,
            diameterMm: measureOf(diameterCell.text),
            lengthMm: measureOf(lengthCell.text),
            anvisaHolders: sinHolders,
            anvisaNames: [...new Set([family, line])],
            documentUrl,
            page: pageNumber,
          })
        }
      }
    }
  }
  return { items, rejected }
}
