-- The same canonical post forms as normaliseUrl (#20). Preserve both Memories
-- on a per-owner collision, as in 0020; no content, Indexing or Categories change.
DO $$
DECLARE
  candidate record;
  path text;
  parts text[];
  canonical text;
  skipped integer := 0;
  collision_constraint text;
BEGIN
  FOR candidate IN
    SELECT id, user_id, source_url_normalised AS url
    FROM memory
    WHERE source_url_normalised ~ '^https?://((www\.|mobile\.)?(x|twitter)\.com/|(www\.|m\.)?tiktok\.com/|(www\.)?instagram\.com/)'
    ORDER BY last_saved_at DESC, id
    FOR UPDATE
  LOOP
    canonical := NULL;
    path := regexp_replace(split_part(split_part(candidate.url, '?', 1), '#', 1), '^https?://[^/]+', '');
    IF candidate.url ~ '^https?://(www\.|mobile\.)?(x|twitter)\.com/' THEN
      parts := regexp_match(path, '^/([A-Za-z0-9_]{1,15}|i/web)/status/([0-9]+)(/|$)');
      IF parts IS NOT NULL THEN
        canonical := 'https://x.com/' || CASE WHEN parts[1] = 'i/web' THEN 'i' ELSE parts[1] END || '/status/' || parts[2];
      END IF;
    ELSIF candidate.url ~ '^https?://(www\.|m\.)?tiktok\.com/' THEN
      parts := regexp_match(path, '^/(@[A-Za-z0-9_.-]+)/(video|photo)/([0-9]+)/?$');
      IF parts IS NOT NULL THEN
        canonical := 'https://www.tiktok.com/' || parts[1] || '/' || parts[2] || '/' || parts[3];
      END IF;
    ELSE
      parts := regexp_match(path, '^/(?:[A-Za-z0-9_.]+/)?(p|reel|reels)/([A-Za-z0-9_-]+)/?$');
      IF parts IS NOT NULL THEN
        canonical := 'https://www.instagram.com/' || CASE WHEN parts[1] = 'p' THEN 'p' ELSE 'reel' END || '/' || parts[2] || '/';
      END IF;
    END IF;
    IF canonical IS NULL OR canonical = candidate.url THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM memory WHERE user_id = candidate.user_id
      AND source_url_normalised = canonical AND id <> candidate.id) THEN
      skipped := skipped + 1;
      CONTINUE;
    END IF;
    BEGIN
      UPDATE memory SET source_url_normalised = canonical WHERE id = candidate.id;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS collision_constraint = CONSTRAINT_NAME;
      IF collision_constraint <> 'memory_user_source_idx' THEN RAISE; END IF;
      skipped := skipped + 1;
    END;
  END LOOP;
  IF skipped > 0 THEN
    RAISE NOTICE 'social URL migration: skipped % conflicting Memories', skipped;
  END IF;
END $$;
