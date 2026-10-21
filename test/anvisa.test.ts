import assert from 'node:assert/strict'
import { test } from 'node:test'
import { migrate } from '../src/db/migrate.js'
import { anvisaSource } from '../src/sources/anvisa/index.js'
import { AnvisaFormatError, columns, parseRegistrations } from '../src/sources/anvisa/parse.js'
import { publishRegistrations } from '../src/sources/anvisa/publish.js'
import { PgliteDatabase } from './pglite-database.js'

const updatedAt = '10/12/2026 19:00:00'

function csv(rows: readonly string[]): Buffer {
  return Buffer.from([columns.join(';'), ...rows].join('\r\n'), 'latin1')
}

const straumannTlx = [
  `10344420506;25351000000000001;Implantes Dentarios (Osseointegravel);III;IMPLANTES STRAUMANN® TLX 4mm;10.344.420/0001-99;JJGC INDÚSTRIA E COMÉRCIO DE MATERIAIS DENTÁRIOS S.A.;INSTITUT STRAUMANN AG;SUÍÇA;10/11/2025;10/11/2035;${updatedAt}`,
  `10344420506;25351000000000001;Implantes Dentarios (Osseointegravel);III;IMPLANTES STRAUMANN® TLX 4mm;10.344.420/0001-99;JJGC INDÚSTRIA E COMÉRCIO DE MATERIAIS DENTÁRIOS S.A.;;;10/11/2025;10/11/2035;${updatedAt}`,
]
const bioOss = `80696930002;25351000000000002;ENXERTO PARA OSSOS E DISPOSITIVOS ASSOCIADOS;IV;GEISTLICH BIO-OSS®;12.345.678/0001-90;GEISTLICH PHARMA DO BRASIL LTDA;GEISTLICH PHARMA AG;SUÍÇA;21/07/2014;VIGENTE;${updatedAt}`
const aorticGraft = `10000000001;25351000000000003;Enxertos;IV;Enxerto aórtico valvado;11.111.111/0001-11;ST. JUDE MEDICAL BRASIL LTDA.;ST. JUDE;EUA;01/01/2010;VIGENTE;${updatedAt}`
const catheter = `10196320017;250000001639918;Cateteres;IV;CATETER DUPLO LUMEN;51943645000107;BIOMEDICAL LTDA.;BIOMEDICAL LTDA.;BRASIL;11/03/1999;01/03/2034;${updatedAt}`

test('agrupa linhas por registro, filtra implantes e enxertos ósseos e normaliza campos', () => {
  const { registrations, rejected } = parseRegistrations(csv([...straumannTlx, bioOss, aorticGraft, catheter]))
  assert.equal(rejected, 0)
  assert.deepEqual(registrations, [
    {
      number: '10344420506',
      category: 'implant',
      processNumber: '25351000000000001',
      technicalName: 'Implantes Dentarios (Osseointegravel)',
      riskClass: 'III',
      commercialName: 'IMPLANTES STRAUMANN® TLX 4mm',
      holderCnpj: '10344420000199',
      holderName: 'JJGC INDÚSTRIA E COMÉRCIO DE MATERIAIS DENTÁRIOS S.A.',
      manufacturers: [{ name: 'INSTITUT STRAUMANN AG', country: 'SUÍÇA' }],
      publishedOn: '2025-11-10',
      validUntil: '2035-11-10',
    },
    {
      number: '80696930002',
      category: 'graft',
      processNumber: '25351000000000002',
      technicalName: 'ENXERTO PARA OSSOS E DISPOSITIVOS ASSOCIADOS',
      riskClass: 'IV',
      commercialName: 'GEISTLICH BIO-OSS®',
      holderCnpj: '12345678000190',
      holderName: 'GEISTLICH PHARMA DO BRASIL LTDA',
      manufacturers: [{ name: 'GEISTLICH PHARMA AG', country: 'SUÍÇA' }],
      publishedOn: '2014-07-21',
      validUntil: null,
    },
  ])
})

test('rejeita linhas inválidas e registros com linhas divergentes sem fundi-las', () => {
  const divergent = straumannTlx[0]?.replace('10/11/2035', '10/11/2036') ?? ''
  const badDate = bioOss.replace('21/07/2014', '31/02/2014')
  const shortRow = '10344420999;1;Implantes Dentarios (Osseointegravel);III'
  const { registrations, rejected } = parseRegistrations(csv([...straumannTlx, divergent, badDate, shortRow]))
  assert.deepEqual(registrations, [])
  assert.equal(rejected, 5)
})

test('falha quando o cabeçalho da fonte muda', () => {
  const changed = Buffer.from(['NUMERO_REGISTRO;NOME', '1;a'].join('\n'), 'latin1')
  assert.throws(() => parseRegistrations(changed), AnvisaFormatError)
})

test('publica, versiona, aposenta e restaura registros sem apagar', async () => {
  const database = await PgliteDatabase.create()
  await migrate(database)
  const runIds: string[] = []
  for (let index = 0; index < 4; index += 1) {
    const [row] = await database.query<{ id: string }>(
      `INSERT INTO catalog_sync.sync_runs (source_id, trigger, status, trace_id) VALUES ('anvisa', 'schedule', 'running', 't') RETURNING id`,
    )
    if (row) runIds.push(row.id)
  }
  const publish = (rows: readonly string[], runId: string | undefined) =>
    database.transaction((tx) =>
      publishRegistrations(tx, parseRegistrations(csv(rows)).registrations, { runId: runId ?? '', now: new Date('2026-10-20T06:00:00Z') }),
    )

  assert.deepEqual(await publish([...straumannTlx, bioOss], runIds[0]), { created: 2, updated: 0, unchanged: 0, retired: 0 })
  assert.equal(await anvisaSource.countPublished(database), 2)

  const renewed = bioOss.replace('VIGENTE', '21/07/2034')
  assert.deepEqual(await publish([...straumannTlx, renewed], runIds[1]), { created: 0, updated: 1, unchanged: 1, retired: 0 })

  assert.deepEqual(await publish([renewed], runIds[2]), { created: 0, updated: 0, unchanged: 1, retired: 1 })
  assert.equal(await anvisaSource.countPublished(database), 1)

  assert.deepEqual(await publish([...straumannTlx, renewed], runIds[3]), { created: 0, updated: 1, unchanged: 1, retired: 0 })

  const records = await database.query<{ number: string; valid_until: Date | null; in_source: boolean }>(
    'SELECT number, valid_until, in_source FROM catalog_sync.regulatory_records ORDER BY number',
  )
  assert.deepEqual(
    records.map((record) => [record.number, record.valid_until?.toISOString().slice(0, 10) ?? null, record.in_source]),
    [
      ['10344420506', '2035-11-10', true],
      ['80696930002', '2034-07-21', true],
    ],
  )
  const changes = await database.query<{ number: string; change: string }>(
    `SELECT r.number, v.change FROM catalog_sync.regulatory_record_versions v
     JOIN catalog_sync.regulatory_records r ON r.id = v.regulatory_record_id
     ORDER BY v.id`,
  )
  assert.deepEqual(
    changes.map((row) => `${row.number}:${row.change}`),
    ['10344420506:created', '80696930002:created', '80696930002:updated', '10344420506:retired', '10344420506:restored'],
  )
})
