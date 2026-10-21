import { catalogSource, parsePdfs } from '../../catalog/source.js'
import { parseNobel } from './parse.js'

// O site exige um "Client Challenge" (anti-bot) que não contornamos; o PDF do catálogo é servido direto.
const catalogUrl = 'https://www.nobelbiocare.com/sites/g/files/wdvifx201/files/89351Catalog2024_Aug28.pdf'

export const nobelSource = catalogSource({
  id: 'nobel',
  allowedHosts: ['www.nobelbiocare.com'],
  license: 'Nobel Biocare Product Catalog (material público do fabricante)',
  minimumItems: 200,
  locate: async () => [catalogUrl],
  parse: parsePdfs((lines, document) => parseNobel(lines, document.url)),
})
