import { linksIn } from '../../catalog/links.js'
import { catalogSource, parsePdfs } from '../../catalog/source.js'
import { parseSin } from './parse.js'

const downloadsUrl = 'https://www.sinimplantsystem.com.br/downloads/'

// Linhas cujos catálogos trazem tabelas de implantes (Duotech, por exemplo, é guia cirúrgico digital).
const implantLines = ['Strong', 'Tryon', 'Unitite']

const catalogName = /\/Catalogo-([A-Za-z]+)-PTBR-(\d{4})\.pdf$/

export function latestCatalogs(links: readonly string[]): string[] {
  const latest = new Map<string, { url: string; year: number }>()
  for (const url of links) {
    const match = catalogName.exec(url)
    const line = match?.[1]
    const year = Number(match?.[2])
    if (!line || !implantLines.includes(line)) continue
    const current = latest.get(line)
    if (!current || year > current.year) latest.set(line, { url, year })
  }
  return [...latest.values()].map((entry) => entry.url).sort()
}

function lineOf(url: string): string {
  const line = catalogName.exec(url)?.[1]
  if (!line) throw new Error(`Catálogo S.I.N. fora do padrão: ${url}`)
  return line
}

export const sinSource = catalogSource({
  id: 'sin',
  allowedHosts: ['www.sinimplantsystem.com.br', 'd31hw89ycmfplm.cloudfront.net'],
  license: 'Catálogos S.I.N. Implant System (material público do fabricante)',
  minimumItems: 150,
  async locate(fetchPage) {
    const urls = latestCatalogs(linksIn(await fetchPage(downloadsUrl), downloadsUrl))
    if (urls.length !== implantLines.length) {
      throw new Error(`Esperados catálogos ${implantLines.join(', ')}; encontrados: ${urls.join(', ') || 'nenhum'}.`)
    }
    return urls
  },
  parse: parsePdfs((lines, document) => parseSin(lines, lineOf(document.url), document.url)),
})
