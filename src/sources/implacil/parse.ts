import type { ImplantItem } from '../../catalog/items.js'
import type { PdfCell, PdfLine } from '../../pdf/lines.js'

export const implacilHolders = ['05741680000118', '32356774000146']

const tocDiameters = /^Ø\d+(?:\.\d+)?(?: \| \d+(?:\.\d+)?)*$/
const tocLengths = /mm$/
const tocPage = /^\d{1,3}$/
const osstemLine = /^TSI(?:II|V) (?:CA|SA)$/
const headerDiameter = /^Ø(\d+(?:\.\d+)?) mm$/
const rowLength = /^(\d{1,2}(?:\.\d)?) mm$/
const code = /^[A-Z0-9]{5,12}$/
const missing = new Set(['–', '-'])
const columnTolerance = 15

type Entry = { name: string; diameters: number[] | null }

// Sumário: "Maestro Superiore | Ø3.5 | 4.0 | 5.0 | 7 | 9 | 11 | 13 | 15 mm | 12"; as linhas Osstem não trazem diâmetros.
export function tableOfContents(lines: readonly PdfLine[]): Map<number, Entry> {
  const entries = new Map<number, Entry>()
  for (const line of lines) {
    const cells = line.cells
    cells.forEach((cell, index) => {
      const name = cells[index - 1]
      const lengths = cells[index + 1]
      const page = cells[index + 2]
      if (tocDiameters.test(cell.text) && name && lengths && page && tocLengths.test(lengths.text) && tocPage.test(page.text)) {
        const diameters = cell.text.replace('Ø', '').split(' | ').map(Number)
        entries.set(Number(page.text), { name: name.text, diameters })
      }
      if (osstemLine.test(cell.text)) {
        const lengthsAt = cells.findIndex((candidate, at) => at > index && at <= index + 2 && tocLengths.test(candidate.text))
        const target = lengthsAt > 0 ? cells[lengthsAt + 1] : undefined
        if (target && tocPage.test(target.text)) entries.set(Number(target.text), { name: cell.text, diameters: null })
      }
    })
  }
  return entries
}

// O sumário pode anunciar diâmetros que a tabela não lista; o contrário indicaria página trocada.
function within(table: readonly number[], announced: readonly number[]): boolean {
  return table.every((value) => announced.includes(value))
}

function shape(text: string): string {
  return text.replace(/\d/g, '9').replace(/[A-Z]/g, 'A')
}

// Nota de rodapé colada ao código ("22071²" vira "220712") só aparece como formato destoante da tabela.
function dominantShape(codes: readonly string[]): string | null {
  const counts = new Map<string, number>()
  for (const value of codes) counts.set(shape(value), (counts.get(shape(value)) ?? 0) + 1)
  const ranked = [...counts].sort((a, b) => b[1] - a[1])
  const [first, second] = ranked
  if (!first) return null
  return second && second[1] === first[1] ? null : first[0]
}

function familyOf(name: string): string {
  return name.replace(/\s+(?:CM AR|CM|HE|HI)(?:\s+5\/6 mm)?$/, '').trim()
}

function nearest(cells: readonly PdfCell[], x: number): PdfCell | null {
  let best: PdfCell | null = null
  for (const cell of cells) {
    if (Math.abs(cell.x - x) <= columnTolerance && (!best || Math.abs(cell.x - x) < Math.abs(best.x - x))) best = cell
  }
  return best
}

export function parseImplacil(lines: readonly PdfLine[], documentUrl: string): { items: ImplantItem[]; rejected: number } {
  const contents = tableOfContents(lines)
  const pages = new Map<number, PdfLine[]>()
  for (const line of lines) pages.set(line.page, [...(pages.get(line.page) ?? []), line])

  const items: ImplantItem[] = []
  let rejected = 0
  for (const [pageNumber, page] of pages) {
    const start = page.findIndex((line) => line.cells.some((cell) => cell.text === 'CÓDIGOS'))
    const marker = page[start]?.cells.find((cell) => cell.text === 'CÓDIGOS')
    if (!marker) continue
    const end = page.findIndex((line, index) => index > start && line.cells.some((cell) => cell.text === 'ESPECIFICAÇÕES'))
    const block = page.slice(start + 1, end < 0 ? undefined : end)
    const lengthOf = (line: PdfLine) => line.cells.find((cell) => cell.x >= marker.x - 30 && rowLength.test(cell.text))
    const header = block.flatMap((line) => line.cells.filter((cell) => headerDiameter.test(cell.text)))
    const rows = block.filter((line) => lengthOf(line) !== undefined)
    const codes = rows.flatMap((line) => line.cells.filter((cell) => cell.x > marker.x && code.test(cell.text)).map((cell) => cell.text))

    const entry = contents.get(pageNumber)
    const tableDiameters = header.map((cell) => Number(headerDiameter.exec(cell.text)?.[1]))
    const expectedShape = dominantShape(codes)
    if (!entry || header.length === 0 || !expectedShape || (entry.diameters && !within(tableDiameters, entry.diameters))) {
      rejected += codes.length
      continue
    }

    for (const line of rows) {
      const lengthCell = lengthOf(line)
      if (!lengthCell) continue
      const lengthMm = Number(rowLength.exec(lengthCell.text)?.[1])
      const resolved: { reference: string; diameterMm: number }[] = []
      let failed = false
      for (const cell of line.cells.filter((candidate) => candidate.x > lengthCell.x + 20)) {
        if (missing.has(cell.text)) continue
        const column = nearest(header, cell.x)
        if (!code.test(cell.text) || shape(cell.text) !== expectedShape || !column) {
          failed = true
          break
        }
        resolved.push({ reference: cell.text, diameterMm: Number(headerDiameter.exec(column.text)?.[1]) })
      }
      if (failed) {
        rejected += line.cells.filter((cell) => code.test(cell.text)).length
        continue
      }
      for (const { reference, diameterMm } of resolved) {
        items.push({
          kind: 'implant',
          manufacturer: 'Implacil Osstem',
          model: entry.name,
          reference,
          diameterMm,
          lengthMm,
          anvisaHolders: implacilHolders,
          anvisaNames: [...new Set([entry.name, familyOf(entry.name)])],
          documentUrl,
          page: pageNumber,
        })
      }
    }
  }
  return { items, rejected }
}
