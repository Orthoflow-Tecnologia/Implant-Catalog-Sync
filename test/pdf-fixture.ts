import type { PdfLine } from '../src/pdf/lines.js'

// Trechos copiados dos dumps dos catálogos reais: "p10 y509 | 43:ST 3707 | 88:3,75".
export function pdfFixture(dump: string): PdfLine[] {
  return dump
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const [position = '', ...rawCells] = line.split(/ \| (?=-?\d+:)/)
      const match = /^p(\d+) y(-?\d+)$/.exec(position)
      if (!match) throw new Error(`Linha de fixture inválida: ${line}`)
      const cells = rawCells.map((raw) => {
        const separator = raw.indexOf(':')
        return { x: Number(raw.slice(0, separator)), text: raw.slice(separator + 1) }
      })
      return { page: Number(match[1]), y: Number(match[2]), cells, text: cells.map((cell) => cell.text).join(' ') }
    })
}
