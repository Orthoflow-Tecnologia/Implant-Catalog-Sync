import { publishWithProjection } from '../../catalog/source.js'
import type { Source } from '../../sync/source.js'
import { parseRegistrations } from './parse.js'
import { publishRegistrations } from './publish.js'

const datasetUrl = 'https://dados.anvisa.gov.br/dados/TA_PRODUTO_SAUDE_SITE.csv'

export const anvisaSource: Source = {
  id: 'anvisa',
  allowedHosts: ['dados.anvisa.gov.br'],
  contentTypes: ['application/octet-stream', 'text/csv', 'text/plain'],
  license: 'Dados abertos ANVISA — Produtos para saúde regularizados',
  defaultIntervalHours: 24,
  locate: async () => [datasetUrl],
  async extract(documents) {
    const [dataset] = documents
    if (!dataset) throw new Error('Base da ANVISA ausente.')
    const { registrations, rejected } = parseRegistrations(dataset.body)
    return {
      captured: registrations.length,
      rejected,
      publish: (tx, context) => publishWithProjection(tx, context, () => publishRegistrations(tx, registrations, context)),
    }
  },
  async countPublished(db) {
    const [row] = await db.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM catalog_sync.regulatory_records WHERE authority = 'ANVISA' AND in_source`,
    )
    return row?.total ?? 0
  },
}
