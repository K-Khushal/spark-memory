CREATE TABLE import_job (
  id uuid PRIMARY KEY, user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'loading' CHECK (state IN ('loading','running','paused','cancelled','done')),
  total integer NOT NULL CHECK (total BETWEEN 1 AND 10000),
  loaded integer NOT NULL DEFAULT 0, done integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0, spread boolean NOT NULL DEFAULT true,
  available_at timestamp NOT NULL DEFAULT now(), created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX import_job_pending ON import_job (available_at) WHERE state = 'running';
--> statement-breakpoint
CREATE TABLE import_item (
  job_id uuid NOT NULL REFERENCES import_job(id) ON DELETE CASCADE,
  position integer NOT NULL, input jsonb NOT NULL, PRIMARY KEY (job_id, position)
);
