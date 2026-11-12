-- Deep fetch (#21, ADR-0010): the second attempt at a link or video that
-- Gather found too little of. State lives on the Memory; `deep_fetch_run`
-- fences queue messages like `index_run` does (Try Again starts a new run).
ALTER TABLE memory
  ADD COLUMN deep_fetch_state text,
  ADD COLUMN deep_fetch_run integer NOT NULL DEFAULT 0,
  ADD COLUMN deep_fetch_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN deep_fetch_due_at timestamptz,
  ADD COLUMN deep_fetch_lease_until timestamptz,
  ADD COLUMN deep_fetch_error text;
--> statement-breakpoint
CREATE INDEX memory_deep_fetch_due_idx ON memory (deep_fetch_due_at)
  WHERE deep_fetch_state IN ('queued', 'running');
--> statement-breakpoint
-- Per person and UTC day (PLAN.md §4). Later tickets add their counters here.
CREATE TABLE usage_day (
  user_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  day date NOT NULL,
  deep_fetches integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
--> statement-breakpoint
-- What each engine has spent of its free tier: `window` is a UTC day or a
-- month (budgetWindow in @spark/core), `seconds` its browser or CPU time.
CREATE TABLE deep_fetch_usage (
  engine text NOT NULL,
  "window" text NOT NULL,
  seconds integer NOT NULL DEFAULT 0,
  PRIMARY KEY (engine, "window")
);
