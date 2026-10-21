import { catalogSource, parsePdfs } from '../../catalog/source.js'
import { parseNeodent } from './parse.js'

// A página do catálogo responde 403 ("Maintenance") a clientes automatizados; o PDF tem endereço estável no media center.
const catalogUrl =
  'https://www.straumann.com/content/dam/media-center/neodent/pt-br/documents/catalog/product-catalog/102_neodent_institutional_catalogue_pt_br_K01_of_060326_LOW.pdf'

export const neodentSource = catalogSource({
  id: 'neodent',
  allowedHosts: ['www.straumann.com'],
  license: 'Catálogo institucional Neodent (material público do fabricante)',
  minimumItems: 250,
  locate: async () => [catalogUrl],
  parse: parsePdfs((lines, document) => parseNeodent(lines, document.url)),
})
