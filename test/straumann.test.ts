import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseStraumann } from '../src/sources/straumann/parse.js'
import { pdfFixture } from './pdf-fixture.js'

test('lê implantes da seção numerada, com plataforma e superfície da coluna de dimensões', () => {
  const { items, rejected } = parseStraumann(
    pdfFixture(`
      p6 y737 | 95:1.1.2 | 127:BLX Implants SLActive®
      p6 y717 | 100:Art. No. | 146:Image | 231:Article | 356:Dimensions | 510:Material
      p6 y698 | 105:061.3308 | 356:∅3.5mm RB, SLActive® 8mm
      p6 y685 | 105:061.3310 | 356:∅3.5mm RB, SLActive® 10mm
      p6 y669 | 231:Straumann BLX™ Implant | 510:Roxolid®
      p6 y225 | 105:061.9306 | 356:∅6.5mmWB, SLActive® 6mm
      p6 y214 | 105:061.9308 | 356:∅6.5mm WB, SLA® 8mm
      p7 y737 | 95:1.2 | 127:Healing Abutments
      p7 y698 | 105:065.0001 | 356:∅4.5mm RB, SLActive® 8mm
    `),
    'straumann.pdf',
  )
  assert.equal(rejected, 1)
  assert.deepEqual(
    items.map((item) => [item.reference, item.model, item.diameterMm, item.lengthMm, item.anvisaNames]),
    [
      ['061.3308', 'BLX RB SLActive', 3.5, 8, ['BLX']],
      ['061.3310', 'BLX RB SLActive', 3.5, 10, ['BLX']],
      ['061.9306', 'BLX WB SLActive', 6.5, 6, ['BLX']],
    ],
  )
})
