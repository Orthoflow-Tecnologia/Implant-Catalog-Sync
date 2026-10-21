# Implant Catalog Sync

Serviço sem interface que coleta catálogos oficiais de implantes dentários e enxertos ósseos, normaliza os dados e grava no PostgreSQL. Roda como cron no Railway: cada execução sincroniza as fontes cujo intervalo venceu e encerra.

Especificação: [Implant Catalog Sync — arquitetura, fontes de dados e especificação](https://linear.app/felpszip/document/implant-catalog-sync-arquitetura-fontes-de-dados-e-especificacao-5297399fa1f0).

## Fontes

| Fonte | Origem | Grava em |
| --- | --- | --- |
| `anvisa` | [Dados abertos ANVISA — produtos para saúde](https://dados.anvisa.gov.br/dados/TA_PRODUTO_SAUDE_SITE.csv) | `catalog_sync.regulatory_records` |

A base da ANVISA informa registro, detentor, fabricante e validade. Ela não traz referência comercial, dimensões, granulometria nem lote, e o serviço não infere esses dados.

## Como uma execução funciona

1. Aplica as migrations pendentes do schema `catalog_sync`.
2. Para cada fonte, pula se a última sincronização bem-sucedida for mais recente que o intervalo da fonte.
3. Obtém o lock da fonte (lease em `catalog_sync.source_locks`). Se outro processo detém o lock, pula.
4. Baixa com `If-None-Match`/`If-Modified-Since`. HTTP 304 ou checksum igual ao último publicado encerra como `unchanged`.
5. Guarda o payload bruto comprimido em `catalog_sync.source_records`, uma linha por checksum.
6. Extrai e normaliza. Cabeçalho inesperado, ou mais de `SYNC_MAX_DROP_RATIO` dos itens publicados sumindo, faz a execução falhar sem tocar no catálogo.
7. Publica numa transação: cria, atualiza, aposenta (`in_source = false`) ou restaura, gravando cada mudança em `regulatory_record_versions`. Nada é apagado.
8. Registra contadores, erro e `traceId` em `catalog_sync.sync_runs` e sai com código 1 se alguma fonte falhou.

## Desenvolvimento

```sh
npm ci
docker run -d --name catalog-sync-pg -e POSTGRES_USER=sync -e POSTGRES_PASSWORD=sync -e POSTGRES_DB=catalog \
  -p 127.0.0.1:55432:5432 postgres:17-alpine
export DATABASE_URL=postgres://sync:sync@127.0.0.1:55432/catalog

npm run sync                                # ciclo agendado
npm run sync -- --source anvisa --force     # reexecução manual: ignora intervalo, ETag e checksum
npm run typecheck
npm test                                    # PGlite em memória, sem Docker
```

Variáveis em [`.env.example`](.env.example).

## Deploy no Railway

O [`railway.json`](railway.json) configura o build pelo `Dockerfile` e o cron `0 * * * *` (UTC) com `restartPolicyType: NEVER`. O cron acorda de hora em hora; cada fonte só roda quando seu intervalo venceu, e uma falha é repetida no ciclo seguinte.

1. Crie o serviço a partir deste repositório.
2. Defina `DATABASE_URL` apontando para o PostgreSQL (referência `${{Postgres.DATABASE_URL}}`). Use credenciais próprias do sincronizador, sem acesso a dados de pacientes.
3. Para uma reexecução manual, rode localmente com `DATABASE_URL` igual à `DATABASE_PUBLIC_URL` do Postgres: `npm run sync -- --source anvisa --force`. O lock impede conflito com o cron.
