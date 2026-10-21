import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CatalogItem, GraftItem, ImplantItem } from '../src/catalog/items.js'
import { projectAppCatalog } from '../src/catalog/project.js'
import { stageItems } from '../src/catalog/stage.js'
import { migrate } from '../src/db/migrate.js'
import type { Registration } from '../src/sources/anvisa/parse.js'
import { publishRegistrations } from '../src/sources/anvisa/publish.js'
import { PgliteDatabase } from './pglite-database.js'

// Recorte do schema do app (implante-flow-api, migrations 001 e 008).
const appSchema = `
  CREATE TABLE implant_manufacturers (id text PRIMARY KEY, name text NOT NULL UNIQUE, active boolean NOT NULL DEFAULT true);
  CREATE TABLE implant_models (
    id text PRIMARY KEY, manufacturer_id text NOT NULL REFERENCES implant_manufacturers (id), name text NOT NULL,
    active boolean NOT NULL DEFAULT true, UNIQUE (manufacturer_id, name));
  CREATE TABLE implant_sizes (id text PRIMARY KEY, label text NOT NULL UNIQUE, active boolean NOT NULL DEFAULT true);
  CREATE TABLE graft_manufacturers (id text PRIMARY KEY, name text NOT NULL UNIQUE, active boolean NOT NULL DEFAULT true);
  CREATE TABLE graft_models (
    id text PRIMARY KEY, manufacturer_id text NOT NULL REFERENCES graft_manufacturers (id), name text NOT NULL,
    product_type text NOT NULL, presentations text[] NOT NULL, granulometries text[] NOT NULL DEFAULT '{}',
    active boolean NOT NULL DEFAULT true, UNIQUE (manufacturer_id, name));
  CREATE TABLE implant_references (
    id text PRIMARY KEY, manufacturer_id text NOT NULL REFERENCES implant_manufacturers (id),
    model_id text NOT NULL REFERENCES implant_models (id), reference text NOT NULL,
    size_id text NOT NULL REFERENCES implant_sizes (id), anvisa text NOT NULL DEFAULT '',
    active boolean NOT NULL DEFAULT true, UNIQUE (manufacturer_id, reference));

  INSERT INTO implant_manufacturers (id, name) VALUES ('neodent', 'Neodent');
  INSERT INTO implant_models (id, manufacturer_id, name) VALUES ('helix-gm', 'neodent', 'Helix GM');
  INSERT INTO implant_sizes (id, label) VALUES ('3.5x10', '3.5 × 10 mm');
  INSERT INTO implant_references (id, manufacturer_id, model_id, reference, size_id)
    VALUES ('seed-1', 'neodent', 'helix-gm', '999.999', '3.5x10');
`

function implant(reference: string, lengthMm: number): ImplantItem {
  return {
    kind: 'implant',
    manufacturer: 'Neodent',
    model: 'Helix GM Acqua',
    reference,
    diameterMm: 3.5,
    lengthMm,
    anvisaHolders: ['00489050000184'],
    anvisaNames: ['Helix GM Acqua', 'Helix GM'],
    documentUrl: 'neodent.pdf',
    page: 49,
  }
}

function graft(reference: string, granulometry: string): GraftItem {
  return {
    kind: 'graft',
    manufacturer: 'Geistlich',
    model: 'Bio-Oss',
    reference,
    productType: 'Substituto ósseo',
    presentation: 'po',
    granulometry,
    quantity: '0,25 g',
    anvisaHolders: ['11344677000163'],
    anvisaNames: ['Bio-Oss'],
    documentUrl: 'https://shop.geistlich.com.br/x.html',
    page: null,
  }
}

const helixRegistration: Registration = {
  number: '80001',
  category: 'implant',
  processNumber: '1',
  technicalName: 'Implantes Dentarios (Osseointegravel)',
  riskClass: 'III',
  commercialName: 'IMPLANTE HELIX GM ACQUA',
  holderCnpj: '00489050000184',
  holderName: 'JJGC',
  manufacturers: [],
  publishedOn: null,
  validUntil: null,
}

test('projeta fabricante, modelo, tamanho e referência no app e desativa só as linhas que publicou', async () => {
  const database = await PgliteDatabase.create()
  await migrate(database)
  await database.exec(appSchema)
  const runIds: string[] = []
  for (let index = 0; index < 3; index += 1) {
    const [row] = await database.query<{ id: string }>(
      `INSERT INTO catalog_sync.sync_runs (source_id, trigger, status, trace_id) VALUES ('x', 'schedule', 'running', 't') RETURNING id`,
    )
    if (row) runIds.push(row.id)
  }
  const context = (index: number) => ({ runId: runIds[index] ?? '', now: new Date('2026-10-21T06:00:00Z') })
  const stage = (sourceId: string, items: readonly CatalogItem[], index: number) =>
    database.transaction(async (tx) => {
      await stageItems(tx, sourceId, items, context(index))
      return projectAppCatalog(tx)
    })

  await database.transaction((tx) => publishRegistrations(tx, [helixRegistration], context(0)))
  await stage('geistlich', [graft('306412', '0,25–1 mm'), graft('500303', '1–2 mm')], 0)
  assert.deepEqual(await stage('neodent', [implant('140.943', 8), implant('140.944', 10)], 0), {
    references: 2,
    linked: 2,
    retiredReferences: 0,
    graftModels: 1,
    retiredGraftModels: 0,
  })

  const references = () =>
    database.query<{ id: string; model: string; size_id: string; anvisa: string; active: boolean }>(
      `SELECT r.id, m.name AS model, r.size_id, r.anvisa, r.active
       FROM implant_references r JOIN implant_models m ON m.id = r.model_id ORDER BY r.id`,
    )
  assert.deepEqual(await references(), [
    { id: 'neodent-140.943', model: 'Helix GM Acqua', size_id: '3.5x8', anvisa: '80001', active: true },
    { id: 'neodent-140.944', model: 'Helix GM Acqua', size_id: '3.5x10', anvisa: '80001', active: true },
    { id: 'seed-1', model: 'Helix GM', size_id: '3.5x10', anvisa: '', active: true },
  ])
  assert.deepEqual(await database.query('SELECT id, label FROM implant_sizes ORDER BY id'), [
    { id: '3.5x10', label: '3.5 × 10 mm' },
    { id: '3.5x8', label: '3.5 × 8 mm' },
  ])
  assert.deepEqual(await database.query('SELECT id, name, product_type, presentations, granulometries, active FROM graft_models'), [
    {
      id: 'geistlich-bio-oss',
      name: 'Bio-Oss',
      product_type: 'Substituto ósseo',
      presentations: ['po'],
      granulometries: ['0,25–1 mm', '1–2 mm'],
      active: true,
    },
  ])

  await stage('geistlich', [], 1)
  assert.deepEqual(await stage('neodent', [implant('140.943', 8)], 1), {
    references: 1,
    linked: 1,
    retiredReferences: 1,
    graftModels: 0,
    retiredGraftModels: 0,
  })
  assert.deepEqual(
    (await references()).map((row) => [row.id, row.active]),
    [
      ['neodent-140.943', true],
      ['neodent-140.944', false],
      ['seed-1', true],
    ],
  )
  assert.deepEqual(await database.query('SELECT id, active FROM graft_models'), [{ id: 'geistlich-bio-oss', active: false }])
  assert.deepEqual(await database.query('SELECT id, active FROM implant_models ORDER BY id'), [
    { id: 'helix-gm', active: true },
    { id: 'neodent-helix-gm-acqua', active: true },
  ])
})
