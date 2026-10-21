import type { Source } from '../../sync/source.js'
import { parseRegistrations } from './parse.js'
import { publishRegistrations } from './publish.js'

export const anvisaSource: Source = {
  id: 'anvisa',
  url: 'https://dados.anvisa.gov.br/dados/TA_PRODUTO_SAUDE_SITE.csv',
  allowedHosts: ['dados.anvisa.gov.br'],
  contentTypes: ['application/octet-stream', 'text/csv', 'text/plain'],
  license: 'Dados abertos ANVISA — Produtos para saúde regularizados',
  defaultIntervalHours: 24,
  extract(payload) {
    const { registrations, rejected } = parseRegistrations(payload)
    return {
      captured: registrations.length,
      rejected,
      publish: (tx, context) => publishRegistrations(tx, registrations, context),
    }
  },
  async countPublished(db) {
    const [row] = await db.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM catalog_sync.regulatory_records WHERE authority = 'ANVISA' AND in_source`,
    )
    return row?.total ?? 0
  },
}
