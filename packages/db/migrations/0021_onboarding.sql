ALTER TABLE memory ADD COLUMN sample boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE onboarding (
 user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
 step text NOT NULL DEFAULT 'disclosure' CHECK (step IN ('disclosure','extension','capture','indexing','search','done')),
 paused boolean NOT NULL DEFAULT false,
 samples_seeded boolean NOT NULL DEFAULT false,
 first_successful_search_at timestamptz
);
--> statement-breakpoint
-- People who signed up before first-run onboarding existed have nothing to onboard.
-- Their first search is not an activation, so the event must not fire for them.
INSERT INTO onboarding (user_id, step, paused, samples_seeded, first_successful_search_at)
SELECT id, 'done', true, true, now() FROM "user";
