CREATE TABLE catalog_sync.source_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL,
  url text NOT NULL,
  license text NOT NULL,
  checksum text NOT NULL,
  etag text,
  last_modified text,
  content_type text,
  byte_size integer NOT NULL,
  payload_gzip bytea NOT NULL,
  first_fetched_at timestamptz NOT NULL DEFAULT now(),
  last_fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, checksum)
);

CREATE TABLE catalog_sync.sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL,
  trigger text NOT NULL CHECK (trigger IN ('schedule', 'manual')),
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'unchanged', 'failed')),
  trace_id text NOT NULL,
  source_record_id uuid REFERENCES catalog_sync.source_records (id),
  captured integer NOT NULL DEFAULT 0,
  created integer NOT NULL DEFAULT 0,
  updated integer NOT NULL DEFAULT 0,
  unchanged integer NOT NULL DEFAULT 0,
  retired integer NOT NULL DEFAULT 0,
  rejected integer NOT NULL DEFAULT 0,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX sync_runs_source_started ON catalog_sync.sync_runs (source_id, started_at DESC);

CREATE TABLE catalog_sync.source_locks (
  source_id text PRIMARY KEY,
  holder text NOT NULL,
  locked_until timestamptz NOT NULL
);
