CREATE TABLE catalog_sync.regulatory_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority text NOT NULL CHECK (authority IN ('ANVISA')),
  number text NOT NULL,
  category text NOT NULL CHECK (category IN ('implant', 'graft')),
  process_number text NOT NULL,
  technical_name text NOT NULL,
  risk_class text NOT NULL,
  commercial_name text NOT NULL,
  holder_cnpj text NOT NULL,
  holder_name text NOT NULL,
  manufacturers jsonb NOT NULL,
  published_on date,
  valid_until date,
  content_hash text NOT NULL,
  in_source boolean NOT NULL DEFAULT true,
  first_seen_run_id uuid NOT NULL REFERENCES catalog_sync.sync_runs (id),
  last_seen_run_id uuid NOT NULL REFERENCES catalog_sync.sync_runs (id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (authority, number)
);

COMMENT ON COLUMN catalog_sync.regulatory_records.valid_until IS 'NULL quando a ANVISA informa VIGENTE sem data de vencimento.';
COMMENT ON COLUMN catalog_sync.regulatory_records.in_source IS 'false quando o registro deixou de constar na fonte; nunca é apagado.';

CREATE INDEX regulatory_records_category ON catalog_sync.regulatory_records (category) WHERE in_source;
CREATE INDEX regulatory_records_holder ON catalog_sync.regulatory_records (holder_cnpj);

CREATE TABLE catalog_sync.regulatory_record_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  regulatory_record_id uuid NOT NULL REFERENCES catalog_sync.regulatory_records (id),
  run_id uuid NOT NULL REFERENCES catalog_sync.sync_runs (id),
  change text NOT NULL CHECK (change IN ('created', 'updated', 'retired', 'restored')),
  content_hash text NOT NULL,
  data jsonb NOT NULL,
  recorded_at timestamptz NOT NULL
);

CREATE INDEX regulatory_record_versions_record ON catalog_sync.regulatory_record_versions (regulatory_record_id, recorded_at DESC);
