import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseNeodent } from '../src/sources/neodent/parse.js'
import { pdfFixture } from './pdf-fixture.js'

function summary(dump: string) {
  const { items, rejected } = parseNeodent(pdfFixture(dump), 'neodent.pdf')
  return { rejected, items: items.map((item) => item.kind === 'implant' && `${item.reference} ${item.model} ${item.diameterMm}x${item.lengthMm}`) }
}

test('lê tabelas com diâmetro e superfície nas colunas e comprimento nas linhas', () => {
  const result = summary(`
    p49 y348 | 38:ImplantesHelix GM
    p49 y329 | 41:Ø3,5 | 82:Acqua | 119:NeoPoros | 166:Ø3,75 | 213:Acqua | 250:NeoPoros
    p49 y316 | 61:8,0 | 80:140.943 | 122:109.943 | 193:8,0 | 211:140.976 | 254:109.976
    p49 y302 | 58:10,0 | 80:140.944 | 122:109.944 | 190:10,0 | 211:140.977 | 254:109.977
    p49 y228 | 41:Ø5,0 | 81:Acqua | 119:NeoPoros | 214:Acqua | 251:NeoPoros
    p49 y225 | 170:Ø6,0
    p49 y215 | 61:8,0 | 79:140.953 | 123:109.953 | 193:8,0 | 210:140.1009 | 253:109.1009
    p49 y188 | 57:11,5 | 79:140.955140.956
  `)
  assert.deepEqual(result, {
    rejected: 1,
    items: [
      '140.943 Helix GM Acqua 3.5x8',
      '109.943 Helix GM NeoPoros 3.5x8',
      '140.976 Helix GM Acqua 3.75x8',
      '109.976 Helix GM NeoPoros 3.75x8',
      '140.944 Helix GM Acqua 3.5x10',
      '109.944 Helix GM NeoPoros 3.5x10',
      '140.977 Helix GM Acqua 3.75x10',
      '109.977 Helix GM NeoPoros 3.75x10',
      '140.953 Helix GM Acqua 5x8',
      '109.953 Helix GM NeoPoros 5x8',
      '140.1009 Helix GM Acqua 6x8',
      '109.1009 Helix GM NeoPoros 6x8',
    ],
  })
})

test('lê tabelas com comprimento no cabeçalho, diâmetro acima do bloco e superfície no início da linha', () => {
  const result = summary(`
    p51 y609 | 42:ImplantesDrive GM
    p51 y580 | 116:8,0mm | 164:10,0mm
    p51 y536 | 57:3,5
    p51 y529 | 57:Ø
    p51 y519 | 81:Acqua | 115:140.958 | 166:140.959
    p51 y508 | 76:NeoPoros | 115:109.958 | 166:109.959
    p51 y281 | 100:117.021 | 140:117.022
  `)
  assert.deepEqual(result, {
    rejected: 0,
    items: [
      '140.958 Drive GM Acqua 3.5x8',
      '140.959 Drive GM Acqua 3.5x10',
      '109.958 Drive GM NeoPoros 3.5x8',
      '109.959 Drive GM NeoPoros 3.5x10',
    ],
  })
})
