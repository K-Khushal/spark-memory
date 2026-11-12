-- Reclassify pre-video link Captures without discarding a person's Memory.
-- Vimeo's key was already normalised by Capture; YouTube's URL forms now
-- share the same canonical watch URL as @spark/core's normaliseUrl.
-- A collision is deliberately left intact, with a count-only notice (no
-- Source, text, owner or Memory identifiers in logs). Newer legacy rows
-- are considered first; an existing canonical row is never overwritten.
DO $$
DECLARE
  candidate record;
  video_id text;
  canonical text;
  skipped integer := 0;
  collision_constraint text;
BEGIN
  FOR candidate IN
    SELECT id, user_id, source_url_normalised AS url
    FROM memory
    WHERE kind = 'link' AND source_url_normalised ~
      '^https?://((www\.|m\.)?youtube\.com/|youtu\.be/|(www\.)?vimeo\.com/)'
    ORDER BY last_saved_at DESC, id
    FOR UPDATE
  LOOP
    video_id := NULL;
    canonical := NULL;
    IF candidate.url ~ '^https?://youtu\.be/' THEN
      video_id := substring(candidate.url FROM '^https?://youtu\.be/([A-Za-z0-9_-]{11})(?:/|[?#]|$)');
    ELSIF candidate.url ~ '^https?://(www\.|m\.)?youtube\.com/watch\?' THEN
      video_id := substring(candidate.url FROM '[?&]v=([A-Za-z0-9_-]{11})(?:&|#|$)');
    ELSIF candidate.url ~ '^https?://(www\.|m\.)?youtube\.com/(shorts|embed|live)/' THEN
      video_id := substring(candidate.url FROM '^https?://(?:www\.|m\.)?youtube\.com/(?:shorts|embed|live)/([A-Za-z0-9_-]{11})(?:/|[?#]|$)');
    ELSIF candidate.url ~ '^https?://(www\.)?vimeo\.com/[0-9]+(/|[?#]|$)' THEN
      canonical := candidate.url;
    END IF;
    IF video_id IS NOT NULL THEN
      canonical := 'https://www.youtube.com/watch?v=' || video_id;
    END IF;
    IF canonical IS NULL THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM memory WHERE user_id = candidate.user_id
      AND source_url_normalised = canonical AND id <> candidate.id) THEN
      skipped := skipped + 1;
      CONTINUE;
    END IF;
    BEGIN
      UPDATE memory SET kind = 'video', source_url_normalised = canonical,
        -- A video with no video marker is not gathered, even when its
        -- page/selection metadata remains (indexingStore's gathered check).
        metadata = metadata - 'video', preservation = 'reference_only',
        index_state = 'indexing', index_error = NULL,
        index_run = index_run + 1, revision = revision + 1,
        index_priority = 'background', index_lease_until = NULL, index_lease_run = NULL,
        vectors_space = NULL, vectors_revision = NULL, updated_at = now()
      WHERE id = candidate.id;
      DELETE FROM memory_vector WHERE memory_id = candidate.id;
      DELETE FROM memory_index WHERE memory_id = candidate.id;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS collision_constraint = CONSTRAINT_NAME;
      IF collision_constraint <> 'memory_user_source_idx' THEN RAISE; END IF;
      -- A Capture raced the migration after the collision check. The
      -- subtransaction restores this row and its index before skipping it.
      skipped := skipped + 1;
    END;
  END LOOP;
  IF skipped > 0 THEN
    RAISE NOTICE 'video URL migration: skipped % conflicting Memories', skipped;
  END IF;
END $$;
