import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CatalogFormatError, consolidate, requireMinimum, type ImplantItem } from '../src/catalog/items.js'

function implant(reference: string, overrides: Partial<ImplantItem> = {}): ImplantItem {
  return {
    kind: 'implant',
    manufacturer: 'Neodent',
    model: 'Helix GM Acqua',
    reference,
    diameterMm: 3.5,
    lengthMm: 10,
    anvisaHolders: ['00489050000184'],
    anvisaNames: ['Helix GM Acqua'],
    documentUrl: 'neodent.pdf',
    page: 49,
    ...overrides,
  }
}

test('funde repetições idênticas e rejeita referências divergentes ou medidas implausíveis', () => {
  const { items, rejected } = consolidate(
    [
      implant('140.943'),
      implant('140.943', { page: 50 }),
      implant('140.944'),
      implant('140.944', { lengthMm: 11.5 }),
      implant('140.944'),
      implant('140.945', { diameterMm: 35 }),
    ],
    2,
  )
  assert.deepEqual(
    items.map((item) => item.reference),
    ['140.943'],
  )
  assert.equal(rejected, 2 + 2 + 1 + 1)
})

test('falha quando o catálogo rende menos itens que o mínimo esperado', () => {
  const parsed = { items: [implant('140.943')], rejected: 0 }
  assert.equal(requireMinimum('neodent', parsed, 1), parsed)
  assert.throws(() => requireMinimum('neodent', parsed, 2), CatalogFormatError)
})
