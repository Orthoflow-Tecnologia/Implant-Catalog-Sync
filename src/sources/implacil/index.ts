import { linksIn } from '../../catalog/links.js'
import { catalogSource, parsePdfs } from '../../catalog/source.js'
import { parseImplacil } from './parse.js'

const homeUrl = 'https://implacilosstem.com.br/'

const months = ['JANEIRO', 'FEVEREIRO', 'MARCO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO']

// O catálogo geral é republicado como catalogo-Implacil-Osstem-<MÊS>-<AA>.pdf; vale a edição mais recente linkada na home.
export function latestCatalog(links: readonly string[]): string | null {
  let latest: { url: string; order: number } | null = null
  for (const url of links) {
    const match = /\/catalogo-Implacil-Osstem-([A-ZÇ]+)-(\d{2})\.pdf$/i.exec(decodeURI(url))
    if (!match) continue
    const month = months.indexOf((match[1] ?? '').toUpperCase().replace('Ç', 'C'))
    if (month < 0) continue
    const order = Number(match[2]) * 12 + month
    if (!latest || order > latest.order) latest = { url, order }
  }
  return latest?.url ?? null
}

export const implacilSource = catalogSource({
  id: 'implacil',
  allowedHosts: ['implacilosstem.com.br'],
  license: 'Catálogo Implacil De Bortoli / Osstem (material público do fabricante)',
  minimumItems: 150,
  async locate(fetchPage) {
    const url = latestCatalog(linksIn(await fetchPage(homeUrl), homeUrl))
    if (!url) throw new Error('Nenhum catálogo Implacil Osstem linkado na página inicial.')
    return [url]
  },
  parse: parsePdfs((lines, document) => parseImplacil(lines, document.url)),
})
