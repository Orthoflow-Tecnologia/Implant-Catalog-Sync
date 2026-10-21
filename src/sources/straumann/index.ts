import { catalogSource, parsePdfs } from '../../catalog/source.js'
import { parseStraumann } from './parse.js'

// Páginas HTML da Straumann respondem 403 ("Maintenance") a clientes automatizados; o PDF tem endereço estável.
const catalogUrl =
  'https://www.straumann.com/content/dam/media-center/straumann/en/documents/brochure/technical-information/450.036-en_low.pdf'

export const straumannSource = catalogSource({
  id: 'straumann',
  allowedHosts: ['www.straumann.com'],
  license: 'Straumann Dental Implant System — Product Catalog (material público do fabricante)',
  minimumItems: 300,
  locate: async () => [catalogUrl],
  parse: parsePdfs((lines, document) => parseStraumann(lines, document.url)),
})
