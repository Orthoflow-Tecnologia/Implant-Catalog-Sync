# Implant Catalog Sync

Serviço sem interface que coleta catálogos oficiais de implantes dentários e enxertos ósseos, normaliza os dados e grava no PostgreSQL. Roda como cron no Railway: cada execução sincroniza as fontes cujo intervalo venceu e encerra.

Especificação: [Implant Catalog Sync — arquitetura, fontes de dados e especificação](https://linear.app/felpszip/document/implant-catalog-sync-arquitetura-fontes-de-dados-e-especificacao-5297399fa1f0).

## Fontes

| Fonte | Origem | Staging | Catálogo do app |
| --- | --- | --- | --- |
| `anvisa` | [Dados abertos ANVISA](https://dados.anvisa.gov.br/dados/TA_PRODUTO_SAUDE_SITE.csv) | `catalog_sync.regulatory_records` | carimba o número ANVISA nas referências já publicadas |
| `neodent` | Catálogo institucional Neodent (PDF) | `catalog_sync.catalog_items` | `implant_manufacturers` / `implant_models` / `implant_sizes` / `implant_references` |
| `straumann` | Product Catalog Straumann (PDF) | idem | idem |
| `nobel` | Catálogos Nobel Biocare (PDF) | idem | idem |
| `sin` | Catálogos S.I.N. (PDF) | idem | idem |
| `implacil` | Catálogo Implacil Osstem (PDF) | idem | idem |
| `geistlich` | Loja Geistlich (HTML) | idem | `graft_manufacturers` / `graft_models` |

A ANVISA informa registro, detentor, fabricante e validade. Ela **não** traz referência comercial, dimensões, granulometria nem lote; o serviço não inventa esses dados. Fabricante, modelo, referência e tamanho vêm dos catálogos dos fabricantes. Quando o cruzamento é inequívoco, o número ANVISA é preenchido em `implant_references.anvisa`.

## Como uma execução funciona

1. Aplica as migrations pendentes do schema `catalog_sync`.
2. Para cada fonte, pula se a última sincronização bem-sucedida for mais recente que o intervalo da fonte.
3. Obtém o lock da fonte (lease em `catalog_sync.source_locks`). Se outro processo detém o lock, pula.
4. Descobre as URLs (`locate`), respeita `robots.txt` e baixa com `If-None-Match`/`If-Modified-Since`. HTTP 304 ou checksum igual ao último publicado encerra como `unchanged`.
5. Guarda metadados do documento em `catalog_sync.source_records` (payload comprimido só até `SYNC_RETAIN_PAYLOAD_MAX_BYTES`).
6. Extrai e normaliza. Formato inesperado, ou mais de `SYNC_MAX_DROP_RATIO` dos itens publicados sumindo, faz a execução falhar sem tocar no catálogo.
7. Publica numa transação no staging (`catalog_items` ou `regulatory_records`) e reconstrói a fatia do catálogo do app (`implant_*` / `graft_*`) a partir de todo o staging vigente. Nada é apagado: itens fora da fonte ficam `in_source = false` / `active = false`.
8. Registra contadores, erro e `traceId` em `catalog_sync.sync_runs` e sai com código 1 se alguma fonte falhou.

## Desenvolvimento

```sh
npm ci
# Com o compose da implante-flow-api (Postgres + tabelas do app):
export DATABASE_URL=postgres://implante:implante@127.0.0.1:5432/implante_flow

npm run sync                                              # ciclo agendado (todas as fontes vencidas)
npm run sync -- --source anvisa,neodent --force           # reexecução manual
npm run typecheck
npm test                                                  # PGlite em memória, sem Docker
```

Variáveis em [`.env.example`](.env.example).

Para ver o que o app consome:

```sql
SELECT m.name AS fabricante, md.name AS modelo, r.reference AS referencia, s.label AS tamanho, r.anvisa
FROM implant_references r
JOIN implant_manufacturers m ON m.id = r.manufacturer_id
JOIN implant_models md ON md.id = r.model_id
JOIN implant_sizes s ON s.id = r.size_id
WHERE r.active
ORDER BY 1, 2, 3
LIMIT 20;
```

## Deploy no Railway

O [`railway.json`](railway.json) configura o build pelo `Dockerfile` e o cron `0 * * * *` (UTC) com `restartPolicyType: NEVER`. O cron acorda de hora em hora; cada fonte só roda quando seu intervalo venceu, e uma falha é repetida no ciclo seguinte.

Imagem publicada: [`ghcr.io/orthoflow-tecnologia/implant-catalog-sync`](https://github.com/orgs/Orthoflow-Tecnologia/packages/container/package/implant-catalog-sync) (`latest`, versão semver e `sha-*`).

1. Crie o serviço a partir deste repositório (ou da imagem GHCR).
2. Defina `DATABASE_URL` apontando para o **mesmo** PostgreSQL da `implante-flow-api` (referência `${{Postgres.DATABASE_URL}}`). Sem as tabelas `implant_*` / `graft_*`, o sync só grava o staging.
3. Use credenciais próprias do sincronizador, sem acesso a dados de pacientes.
4. Para uma reexecução manual, rode localmente com `DATABASE_URL` igual à `DATABASE_PUBLIC_URL` do Postgres: `npm run sync -- --force`. O lock impede conflito com o cron.
