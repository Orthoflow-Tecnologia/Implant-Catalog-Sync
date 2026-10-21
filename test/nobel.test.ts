import assert from 'node:assert/strict'
import { test } from 'node:test'
import { modelName, parseNobel } from '../src/sources/nobel/parse.js'
import { pdfFixture } from './pdf-fixture.js'

test('lê grupos de comprimento por diâmetro com uma coluna por superfície', () => {
  const { items, rejected } = parseNobel(
    pdfFixture(`
      p12 y744 | 60:Conical connection
      p12 y624 | 50:NobelActive®
      p12 y526 | 94:TiUltra™ surface | 337:TiUnite® surface
      p13 y515 | 142:Art. no. | 179:Art. no. | 220:Total | 254:Thread
      p13 y507 | 143:TiUltra | 179:TiUnite | 217:length¹ | 255:height
      p13 y487 | 101:10mm | 143:300240 | 182:36769 | 225:9.5 | 261:8.7
      p13 y471 | 101:11.5mm | 143:300241 | 182:36770 | 222:11.0 | 259:10.2
      p13 y466 | 64:3.0 | 298:3.0 | 335:1.9
      p13 y456 | 101:13mm | 143:300242 | 182:36771 | 222:12.5 | 259:11.7
      p13 y426 | 101:8.5mm | 143:300244 | 182:35221 | 224:8.0 | 261:7.0
      p13 y411 | 101:10mm | 143:300245 | 182:34125 | 224:9.5 | 261:8.5
      p13 y395 | 64:NP | 101:11.5mm | 143:300246 | 182:? | 222:11.0 | 259:10.0
      p13 y387 | 64:3.5 | 298:3.5 | 335:2.6
    `),
    'nobel.pdf',
  )
  assert.equal(rejected, 5)
  assert.deepEqual(
    items.map((item) => [item.reference, item.model, item.diameterMm, item.lengthMm]),
    [
      ['300240', 'NobelActive TiUltra', 3, 10],
      ['36769', 'NobelActive TiUnite', 3, 10],
      ['300241', 'NobelActive TiUltra', 3, 11.5],
      ['36770', 'NobelActive TiUnite', 3, 11.5],
      ['300242', 'NobelActive TiUltra', 3, 13],
      ['36771', 'NobelActive TiUnite', 3, 13],
    ],
  )
  assert.deepEqual(items[0]?.anvisaNames, ['NobelActive TiUltra', 'NobelActive', 'TiUltra'])
})

test('normaliza o título da linha de produto', () => {
  assert.equal(modelName(['Nobel Biocare', 'N1™ system']), 'N1')
  assert.equal(modelName(['NobelParallel™', 'Conical Connection']), 'NobelParallel CC')
})
