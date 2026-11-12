-- Calls anonymised by an earlier deletion still named a Memory. Finished
-- deletions are not replayed, so drop those ids here.
UPDATE "ai_call" SET "memory_id" = NULL, "memory_generation" = NULL WHERE "user_id" = 'deleted';
