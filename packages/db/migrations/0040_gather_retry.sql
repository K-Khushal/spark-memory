ALTER TABLE memory ADD COLUMN gather_retry_at timestamptz;
ALTER TABLE memory ADD COLUMN gather_retried boolean NOT NULL DEFAULT false;
CREATE INDEX memory_gather_retry ON memory (gather_retry_at) WHERE gather_retry_at IS NOT NULL;
