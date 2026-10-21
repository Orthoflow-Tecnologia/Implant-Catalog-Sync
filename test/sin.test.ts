import assert from 'node:assert/strict'
import { test } from 'node:test'
import { latestCatalogs } from '../src/sources/sin/index.js'
import { parseSin } from '../src/sources/sin/parse.js'
import { pdfFixture } from './pdf-fixture.js'

const strongConeMorse = pdfFixture(`
  p29 y429 | 251:DIÂM. | 279:ALT. | 849:RETO
  p29 y425 | 212:CÓD.
  p29 y421 | 251:(mm) | 279:(mm) | 858:DIÂM. | 884:ALT.
  p29 y415 | 95:IMPLANTE | 858:(mm) | 884:(mm)
  p29 y411 | 212:CIM 3502C | 251:3,5 | 279:2,0 | 356:MOLDEIRA ABERTA
  p29 y401 | 129:DIÂM. | 156:ALT. | 212:CIM 3504C | 251:3,5 | 279:4,0 | 806:AIMP 3501C-H | 858:3,5 | 884:1,0
  p29 y398 | 42:CÓD. SW | 82:CÓD. SW PLUS | 393:DIÂM. | 744:1
  p29 y394 | 129:(mm) | 155:(mm) | 351:CÓD.
  p29 y384 | 42:SWCM 3585 | 82:SWCM 3585N | 129:3,5 | 155:8,5 | 212:CIM 4502C | 251:4,5 | 279:2,0 | 351:TMAIM 35C | 393:3,5
  p29 y374 | 42:SWCM 3510 | 82:SWCM 3510N | 129:3,5 | 155:10,0 | 212:CIM 4504C | 251:4,5 | 279:4,0 | 351:TMAIM 45C | 393:4,5
  p29 y255 | 392:(mm) | 1169:CONE MORSE 16º
`)

// A tabela de cicatrizadores ao lado também tem "DIÂM." perto do cabeçalho de códigos dos implantes.
const tryonBesideComponents = pdfFixture(`
  p10 y535 | 216:DIÂM. | 243:ALT. | 421:ANGULADO
  p10 y532 | 179:CÓD.
  p10 y526 | 88:DIÂM. | 114:COMP. | 216:(mm) | 243:(mm)
  p10 y523 | 43:CÓD. | 437:ALTURA DO
  p10 y519 | 88:(mm) | 114:(mm) | 179:CIMU 3308 | 216:3.3 | 243:0.8
  p10 y509 | 43:ST 3707 | 88:3,75 | 114:7,0 | 179:CIMU 3315 | 216:3.3 | 243:1.5
  p10 y490 | 43:ST 3710 | 88:3,75 | 114:10 | 179:CIMU 3335 | 216:3.3 | 243:3.5
  p10 y480 | 43:ST 3711 | 88:– | 114:11,5
  p10 y250 | 1170:CONE MORSE
`)

test('lê tabelas com cabeçalho ALT., variantes por coluna de código e conexão da aba lateral', () => {
  const { items, rejected } = parseSin(strongConeMorse, 'Strong', 'strong.pdf')
  assert.equal(rejected, 0)
  assert.deepEqual(
    items.map((item) => [item.reference, item.model, item.diameterMm, item.lengthMm, item.anvisaNames]),
    [
      ['SWCM 3585', 'Strong SW CM 16°', 3.5, 8.5, ['Strong SW', 'Strong']],
      ['SWCM 3585N', 'Strong SW Plus CM 16°', 3.5, 8.5, ['Strong SW Plus', 'Strong']],
      ['SWCM 3510', 'Strong SW CM 16°', 3.5, 10, ['Strong SW', 'Strong']],
      ['SWCM 3510N', 'Strong SW Plus CM 16°', 3.5, 10, ['Strong SW Plus', 'Strong']],
    ],
  )
})

test('usa as colunas de medida imediatamente à direita dos códigos e rejeita linhas sem medida', () => {
  const { items, rejected } = parseSin(tryonBesideComponents, 'Tryon', 'tryon.pdf')
  assert.equal(rejected, 1)
  assert.deepEqual(
    items.map((item) => [item.reference, item.model, item.diameterMm, item.lengthMm]),
    [
      ['ST 3707', 'Tryon CM', 3.75, 7],
      ['ST 3710', 'Tryon CM', 3.75, 10],
    ],
  )
})

test('descobre o catálogo mais recente de cada linha de implantes', () => {
  const cdn = 'https://d31hw89ycmfplm.cloudfront.net/2022/11'
  assert.deepEqual(
    latestCatalogs([
      `${cdn}/Catalogo-Strong-PTBR-2024.pdf`,
      `${cdn}/Catalogo-Strong-PTBR-2025.pdf`,
      `${cdn}/Catalogo-Tryon-PTBR-2025.pdf`,
      `${cdn}/Catalogo-Duotech-PTBR-2025.pdf`,
      'https://www.sinimplantsystem.com.br/contato/',
    ]),
    [`${cdn}/Catalogo-Strong-PTBR-2025.pdf`, `${cdn}/Catalogo-Tryon-PTBR-2025.pdf`],
  )
})
