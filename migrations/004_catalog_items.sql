CREATE TABLE catalog_sync.catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('implant', 'graft')),
  manufacturer text NOT NULL,
  model text NOT NULL,
  reference text NOT NULL,
  data jsonb NOT NULL,
  content_hash text NOT NULL,
  in_source boolean NOT NULL DEFAULT true,
  first_seen_run_id uuid NOT NULL REFERENCES catalog_sync.sync_runs (id),
  last_seen_run_id uuid NOT NULL REFERENCES catalog_sync.sync_runs (id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (source_id, reference)
);

COMMENT ON TABLE catalog_sync.catalog_items IS 'Itens extraídos dos catálogos dos fabricantes; base da projeção nas tabelas de catálogo do app.';
COMMENT ON COLUMN catalog_sync.catalog_items.in_source IS 'false quando o item saiu do catálogo; nunca é apagado.';

CREATE INDEX catalog_items_published ON catalog_sync.catalog_items (kind, manufacturer) WHERE in_source;

CREATE TABLE catalog_sync.catalog_item_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  catalog_item_id uuid NOT NULL REFERENCES catalog_sync.catalog_items (id),
  run_id uuid NOT NULL REFERENCES catalog_sync.sync_runs (id),
  change text NOT NULL CHECK (change IN ('created', 'updated', 'retired', 'restored')),
  content_hash text NOT NULL,
  data jsonb NOT NULL,
  recorded_at timestamptz NOT NULL
);

CREATE INDEX catalog_item_versions_item ON catalog_sync.catalog_item_versions (catalog_item_id, recorded_at DESC);

CREATE TABLE catalog_sync.app_rows (
  table_name text NOT NULL CHECK (table_name IN ('implant_models', 'implant_references', 'graft_models')),
  row_id text NOT NULL,
  PRIMARY KEY (table_name, row_id)
);

COMMENT ON TABLE catalog_sync.app_rows IS 'Linhas do catálogo do app criadas ou assumidas pela sincronização; só elas são desativadas quando saem da fonte.';
