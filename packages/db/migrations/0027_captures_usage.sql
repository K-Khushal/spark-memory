-- Free allowance (#27): Captures counted per person and UTC day, beside
-- #21's Deep fetches. A Memory a Capture creates takes one in the same
-- transaction; Samples, duplicates and retries take none.
ALTER TABLE usage_day
  ADD COLUMN captures integer NOT NULL DEFAULT 0;
