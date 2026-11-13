-- Free allowance (#27): Captures counted per person and UTC day, beside
-- #21's Deep fetches. A Memory a Capture creates takes one in the same
-- transaction; Samples, duplicates and retries take none.
ALTER TABLE usage_day
  ADD COLUMN captures integer NOT NULL DEFAULT 0;
--> statement-breakpoint
-- A link or text Capture past the day's Captures is kept, keyword-findable
-- only: no Gather, copy, vectors or other AI work, however Indexing would
-- restart (a duplicate save, a copy, an edit, Retry). Set once, never cleared.
ALTER TABLE memory
  ADD COLUMN over_allowance boolean NOT NULL DEFAULT false;
