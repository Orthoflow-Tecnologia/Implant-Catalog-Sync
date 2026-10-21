import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

export type PdfCell = { x: number; text: string }

export type PdfLine = {
  page: number
  y: number
  cells: PdfCell[]
  text: string
}

type Positioned = { x: number; y: number; width: number; text: string }

const sameLineTolerance = 2.5
const cellGap = 4

function linesFrom(items: Positioned[], page: number): PdfLine[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x)
  const rows: Positioned[][] = []
  for (const item of sorted) {
    const row = rows.at(-1)
    const anchor = row?.[0]
    if (row && anchor && Math.abs(anchor.y - item.y) <= sameLineTolerance) row.push(item)
    else rows.push([item])
  }

  return rows.map((row) => {
    const ordered = row.sort((a, b) => a.x - b.x)
    const cells: PdfCell[] = []
    let end = Number.NEGATIVE_INFINITY
    for (const item of ordered) {
      const last = cells.at(-1)
      if (last && item.x - end <= cellGap) last.text += item.text
      else cells.push({ x: item.x, text: item.text })
      end = Math.max(end, item.x + item.width)
    }
    const trimmed = cells
      .map((cell) => ({ x: Math.round(cell.x), text: cell.text.replace(/\s+/g, ' ').trim() }))
      .filter((cell) => cell.text.length > 0)
    return { page, y: Math.round(row[0]?.y ?? 0), cells: trimmed, text: trimmed.map((cell) => cell.text).join(' ') }
  })
}

// Reconstrói linhas visuais a partir das coordenadas; tabelas dos catálogos viram células ordenadas por x.
export async function pdfLines(data: Uint8Array): Promise<PdfLine[]> {
  const loading = getDocument({
    // pdf.js transfere o buffer recebido para o worker; a cópia preserva o do chamador.
    data: new Uint8Array(data),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  })
  try {
    const document = await loading.promise
    const lines: PdfLine[] = []
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const items: Positioned[] = []
      for (const item of content.items) {
        if (!('str' in item) || item.str.trim() === '') continue
        items.push({ x: item.transform[4] ?? 0, y: item.transform[5] ?? 0, width: item.width, text: item.str })
      }
      lines.push(...linesFrom(items, pageNumber).filter((line) => line.cells.length > 0))
      page.cleanup()
    }
    return lines
  } finally {
    await loading.destroy()
  }
}
