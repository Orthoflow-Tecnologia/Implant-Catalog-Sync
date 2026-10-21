ALTER TABLE catalog_sync.source_records ALTER COLUMN payload_gzip DROP NOT NULL;
ALTER TABLE catalog_sync.source_records ALTER COLUMN byte_size TYPE bigint;

COMMENT ON COLUMN catalog_sync.source_records.payload_gzip IS 'NULL quando o documento excede SYNC_RETAIN_PAYLOAD_MAX_BYTES; checksum, URL e ETag continuam registrados.';

CREATE TABLE catalog_sync.sync_run_documents (
  run_id uuid NOT NULL REFERENCES catalog_sync.sync_runs (id),
  source_record_id uuid NOT NULL REFERENCES catalog_sync.source_records (id),
  url text NOT NULL,
  PRIMARY KEY (run_id, url)
);

ALTER TABLE catalog_sync.sync_runs ADD COLUMN checksum text;

INSERT INTO catalog_sync.sync_run_documents (run_id, source_record_id, url)
SELECT s.id, r.id, r.url
FROM catalog_sync.sync_runs s
JOIN catalog_sync.source_records r ON r.id = s.source_record_id;

UPDATE catalog_sync.sync_runs s SET checksum = r.checksum
FROM catalog_sync.source_records r
WHERE r.id = s.source_record_id;

ALTER TABLE catalog_sync.sync_runs DROP COLUMN source_record_id;
