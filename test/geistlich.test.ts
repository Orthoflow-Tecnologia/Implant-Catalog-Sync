import assert from 'node:assert/strict'
import { test } from 'node:test'
import { productLinks } from '../src/sources/geistlich/index.js'
import { parseGeistlichProduct } from '../src/sources/geistlich/parse.js'

function page(name: string, sku: string, table: [string, string, string] | null): string {
  const specification = table
    ? `<table><tbody>
        <tr><th style="padding: 10px;">Apresentação</th><th>${table[0]}</th><th>Volume Aproximado</th></tr>
        <tr><td><strong>${table[1]}</strong></td><td>${table[2]}</td><td>≈ 0,5 cc</td></tr>
      </tbody></table>`
    : ''
  return `<div class="product-info-main" data-product-sku="${sku}">
    <h1 class="page-title"><span class="base" data-ui-id="page-title-wrapper" itemprop="name">${name}</span></h1>
    ${specification}</div>`
}

const url = 'https://shop.geistlich.com.br/produto.html'

test('lê granulometria e apresentação da tabela da página do produto', () => {
  const result = parseGeistlichProduct(
    page('Enxerto Ósseo Geistlich Bio-Oss® Small 0,25 g (0,25–1 mm)', '306412', ['Granulometria', '0,25 g', '0,25–1 mm']),
    url,
  )
  assert.deepEqual(result, {
    item: {
      kind: 'graft',
      manufacturer: 'Geistlich',
      model: 'Bio-Oss',
      reference: '306412',
      productType: 'Substituto ósseo',
      presentation: 'po',
      granulometry: '0,25–1 mm',
      quantity: '0,25 g',
      anvisaHolders: ['11344677000163'],
      anvisaNames: ['Bio-Oss'],
      documentUrl: url,
      page: null,
    },
  })
})

test('classifica como bloco produtos com dimensões, na tabela ou no nome', () => {
  const collagen = parseGeistlichProduct(page('Geistlich Bio-Oss® Collagen 100mg', '305834', ['Dimensões', '100 mg', '5 × 5 × 7 mm']), url)
  const block = parseGeistlichProduct(page('Geistlich Bio-Oss® Block (1x1x2cm)', '306022', null), url)
  assert.deepEqual(
    [collagen, block].map((result) => ('item' in result ? [result.item.model, result.item.presentation, result.item.quantity] : result)),
    [
      ['Bio-Oss Collagen', 'bloco', '100 mg'],
      ['Bio-Oss Block', 'bloco', '1x1x2cm'],
    ],
  )
})

test('rejeita produtos de linha desconhecida ou sem apresentação identificável', () => {
  assert.deepEqual(parseGeistlichProduct(page('Geistlich Bio-Gide® 25x25mm', '30101', null), url), {
    rejected: 'linha desconhecida: Geistlich Bio-Gide 25x25mm',
  })
  assert.deepEqual(parseGeistlichProduct(page('Geistlich Bio-Oss® Large 1g', '500303', null), url), {
    rejected: 'apresentação não identificada: Geistlich Bio-Oss Large 1g',
  })
})

test('lista apenas páginas de produto Bio-Oss da categoria', () => {
  assert.deepEqual(
    productLinks([
      'https://shop.geistlich.com.br/geistlich-bio-ossr-small-025g.html',
      'https://shop.geistlich.com.br/substitutos-osseos/bio-oss-small',
      'https://shop.geistlich.com.br/geistlich-bio-gide.html',
      'https://evil.example/geistlich-bio-oss.html',
    ]),
    ['https://shop.geistlich.com.br/geistlich-bio-ossr-small-025g.html'],
  )
})
