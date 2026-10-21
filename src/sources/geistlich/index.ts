import { consolidate } from '../../catalog/items.js'
import { linksIn } from '../../catalog/links.js'
import { catalogSource } from '../../catalog/source.js'
import { parseGeistlichProduct } from './parse.js'

const categoryUrl = 'https://shop.geistlich.com.br/substitutos-osseos.html'

const productPage = /^https:\/\/shop\.geistlich\.com\.br\/[a-z0-9-]*bio-oss[a-z0-9-]*\.html$/

export function productLinks(links: readonly string[]): string[] {
  return links.filter((url) => productPage.test(url)).sort()
}

export const geistlichSource = catalogSource({
  id: 'geistlich',
  allowedHosts: ['shop.geistlich.com.br'],
  contentTypes: ['text/html'],
  license: 'Loja Geistlich Brasil — páginas públicas de produto',
  minimumItems: 10,
  async locate(fetchPage) {
    const urls = productLinks(linksIn(await fetchPage(categoryUrl), categoryUrl))
    if (urls.length === 0) throw new Error('Nenhum produto Bio-Oss listado na categoria de substitutos ósseos.')
    return urls
  },
  async parse(documents) {
    const results = documents.map((document) => parseGeistlichProduct(document.body.toString('utf8'), document.url))
    const items = results.flatMap((result) => ('item' in result ? [result.item] : []))
    return consolidate(items, results.length - items.length)
  },
})
