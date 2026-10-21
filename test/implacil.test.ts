import assert from 'node:assert/strict'
import { test } from 'node:test'
import { latestCatalog } from '../src/sources/implacil/index.js'
import { parseImplacil } from '../src/sources/implacil/parse.js'
import { pdfFixture } from './pdf-fixture.js'

const contents = 'p8 y767 | 43:Maestro Superiore | 134:Ø3.5 | 4.0 | 5.0 | 197:7 | 9 | 11 | 13 | 15 mm | 268:12'

function codesTable(rows: string): string {
  return `
    p12 y457 | 308:CÓDIGOS
    p12 y440 | 449:Código
    p12 y431 | 325:Comprimento
    p12 y423 | 394:Ø3.5 mm | 447:Ø4.0 mm | 500:Ø5.0 mm
    ${rows}
    p12 y328 | 308:ESPECIFICAÇÕES
    p12 y315 | 319:Comprimento | 427:7 | 9 | 11 | 13 | 15 mm
  `
}

test('lê a tabela de códigos da página indicada no sumário', () => {
  const { items, rejected } = parseImplacil(
    pdfFixture(
      contents +
        codesTable(`
          p12 y408 | 336:7 mm | 398:34027 | 450:34036 | 503:34045
          p12 y395 | 36:Instalação: 20 rpm. | 336:9 mm | 398:34029 | 450:34038 | 504:34047
          p12 y382 | 336:11 mm | 398:34031 | 450:– | 503:340492
        `),
    ),
    'implacil.pdf',
  )
  assert.equal(rejected, 2)
  assert.deepEqual(
    items.map((item) => [item.reference, item.model, item.diameterMm, item.lengthMm]),
    [
      ['34027', 'Maestro Superiore', 3.5, 7],
      ['34036', 'Maestro Superiore', 4, 7],
      ['34045', 'Maestro Superiore', 5, 7],
      ['34029', 'Maestro Superiore', 3.5, 9],
      ['34038', 'Maestro Superiore', 4, 9],
      ['34047', 'Maestro Superiore', 5, 9],
    ],
  )
})

test('rejeita a tabela quando traz diâmetro que o sumário não anuncia', () => {
  const dump = contents.replace('Ø3.5 | 4.0 | 5.0', 'Ø3.5 | 4.0') + codesTable('p12 y408 | 336:7 mm | 398:34027 | 450:34036 | 503:34045')
  assert.deepEqual(parseImplacil(pdfFixture(dump), 'implacil.pdf'), { items: [], rejected: 3 })
})

test('escolhe a edição mais recente do catálogo geral', () => {
  const base = 'https://implacilosstem.com.br/catalogos'
  assert.equal(
    latestCatalog([
      `${base}/catalogo-Implacil-Osstem-NOVEMBRO-25.pdf`,
      `${base}/catalogo-Implacil-Osstem-ABRIL-26.pdf`,
      `${base}/catalogo-Implacil-Osstem-MAR%C3%87O-27.pdf`,
      `${base}/catalogo-produtos-Implacil-2028.pdf`,
    ]),
    `${base}/catalogo-Implacil-Osstem-MAR%C3%87O-27.pdf`,
  )
})
