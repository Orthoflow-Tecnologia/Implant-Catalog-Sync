import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAnvisaLinker, normalizeName, type RegistrationName } from '../src/catalog/anvisa-link.js'
import type { GraftItem, ImplantItem } from '../src/catalog/items.js'

const jjgc = '00489050000184'

function implant(overrides: Partial<ImplantItem>): ImplantItem {
  return {
    kind: 'implant',
    manufacturer: 'Neodent',
    model: 'Helix GM Acqua',
    reference: '140.943',
    diameterMm: 3.5,
    lengthMm: 10,
    anvisaHolders: [jjgc],
    anvisaNames: ['Helix GM Acqua', 'Helix GM'],
    documentUrl: 'neodent.pdf',
    page: 49,
    ...overrides,
  }
}

function registration(number: string, commercialName: string, overrides: Partial<RegistrationName> = {}): RegistrationName {
  return { number, category: 'implant', holderCnpj: jjgc, commercialName, ...overrides }
}

test('normaliza marcas, acentos e palavras genéricas do nome comercial', () => {
  assert.equal(normalizeName('IMPLANTE DENTÁRIO NEODENT® HELIX GM™ Acqua'), 'helix gm acqua')
})

test('prefere o registro do diâmetro, cai para o nome da família e não chuta quando há ambiguidade', () => {
  const link = createAnvisaLinker([
    registration('80001', 'Implante Helix GM Acqua 3.5'),
    registration('80002', 'Implante Helix GM Acqua 4,0 mm'),
    registration('80003', 'Implante Helix GM'),
    registration('80004', 'Implante Drive GM'),
    registration('80005', 'Implante Drive GM'),
    registration('80006', 'Implante Titamax 10'),
    registration('99999', 'Implante Helix GM', { holderCnpj: '11111111000111' }),
  ])
  assert.equal(link(implant({})), '80001')
  assert.equal(link(implant({ diameterMm: 4 })), '80002')
  assert.equal(link(implant({ diameterMm: 5 })), null)
  assert.equal(link(implant({ anvisaNames: ['Helix GM NeoPoros', 'Helix GM'] })), '80003')
  assert.equal(link(implant({ anvisaNames: ['Drive GM'] })), null)
  assert.equal(link(implant({ anvisaNames: ['Titamax'], diameterMm: 4.3 })), null)
})

test('vincula enxertos apenas a registros da categoria enxerto do mesmo detentor', () => {
  const geistlich = '11344677000163'
  const graft: GraftItem = {
    kind: 'graft',
    manufacturer: 'Geistlich',
    model: 'Bio-Oss',
    reference: '306412',
    productType: 'Substituto ósseo',
    presentation: 'po',
    granulometry: '0,25–1 mm',
    quantity: '0,25 g',
    anvisaHolders: [geistlich],
    anvisaNames: ['Bio-Oss'],
    documentUrl: 'https://shop.geistlich.com.br/x.html',
    page: null,
  }
  const link = createAnvisaLinker([
    registration('80696930001', 'GEISTLICH BIO-OSS®', { category: 'implant', holderCnpj: geistlich }),
    registration('80696930002', 'GEISTLICH BIO-OSS®', { category: 'graft', holderCnpj: geistlich }),
  ])
  assert.equal(link(graft), '80696930002')
})
