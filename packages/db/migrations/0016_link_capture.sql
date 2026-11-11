-- Link Memories (#16): the Source, what gathering found, and last_saved_at,
-- which a duplicate Capture bumps and the wall is ordered by. A page is
-- saved once per person (normalised URL), and so is a link's text (content
-- hash). Keyword search learns a link's page title, description and host.

ALTER TABLE "memory" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "source_url_normalised" text;--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "last_saved_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "memory" SET "last_saved_at" = "captured_at";--> statement-breakpoint
CREATE INDEX "memory_user_saved_idx" ON "memory" USING btree ("user_id","last_saved_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "memory_user_source_idx" ON "memory" USING btree ("user_id","source_url_normalised") WHERE "memory"."source_url_normalised" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_user_link_hash_idx" ON "memory" USING btree ("user_id","content_hash") WHERE "memory"."kind" = 'link' and "memory"."content_hash" is not null;--> statement-breakpoint

-- A link's host as words ("www.nytimes.com" → "nytimes.com nytimes com") and its site's name.
CREATE FUNCTION memory_source_text(p_memory memory) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws(' ', h, replace(h, '.', ' '), p_memory.metadata->>'siteName')
  FROM (SELECT regexp_replace(lower(substring(p_memory.source_url
    FROM '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/:?#]+)')), '^www\.', '') AS h) s
$$;
--> statement-breakpoint

-- As 0006, plus a link's page title (A), host and site name (B) and page
-- description (C). These are the page's own words, not a model's, so they
-- count with AI opt-out too.
CREATE OR REPLACE FUNCTION memory_texts(p_memory memory, OUT a text, OUT b text, OUT c text)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  found memory_index;
BEGIN
  IF NOT p_memory.ai_opt_out THEN
    SELECT * INTO found FROM memory_index WHERE memory_id = p_memory.id;
  END IF;
  a := concat_ws(' ', p_memory.title, p_memory.metadata->>'title', found.title);
  b := concat_ws(' ', p_memory.capture_note,
    array_to_string(found.tags, ' '), array_to_string(found.entities, ' '),
    memory_source_text(p_memory));
  c := concat_ws(' ', p_memory.body, p_memory.metadata->>'description',
    found.description, found.ocr_text);
END $$;
--> statement-breakpoint

-- As 0013, plus "source" for a link's host or site name, and "text" or
-- "description" for a link's text or page description.
CREATE OR REPLACE FUNCTION matched_field(p_memory memory, p_query tsquery) RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE
  cfg regconfig := search_config(p_memory.language);
  ocr text;
BEGIN
  IF p_query IS NULL THEN RETURN NULL; END IF;
  IF ts_filter(p_memory.search_tsv, '{a}') @@ p_query THEN RETURN 'title'; END IF;
  IF ts_filter(p_memory.search_tsv, '{b}') @@ p_query THEN
    IF text_matches(cfg, p_memory.capture_note, p_query) THEN RETURN 'note'; END IF;
    IF p_memory.kind = 'link' AND text_matches(cfg, memory_source_text(p_memory), p_query)
      THEN RETURN 'source'; END IF;
    RETURN 'tags';
  END IF;
  IF NOT ts_filter(p_memory.search_tsv, '{c}') @@ p_query THEN RETURN NULL; END IF;
  IF p_memory.kind = 'text' THEN RETURN 'text'; END IF;
  IF p_memory.kind = 'link' THEN
    RETURN CASE WHEN text_matches(cfg, left(p_memory.body, 20000), p_query)
      THEN 'text' ELSE 'description' END;
  END IF;
  SELECT i.ocr_text INTO ocr FROM memory_index i WHERE i.memory_id = p_memory.id;
  RETURN CASE WHEN text_matches(cfg, left(ocr, 20000), p_query)
    THEN 'ocr' ELSE 'description' END;
END $$;
--> statement-breakpoint

-- Both keyword triggers follow the new columns too.
DROP TRIGGER memory_search_tsv ON memory;
--> statement-breakpoint
CREATE TRIGGER memory_search_tsv
BEFORE INSERT OR UPDATE OF title, capture_note, body, language, ai_opt_out, search_tsv, source_url, metadata ON memory
FOR EACH ROW EXECUTE FUNCTION memory_search_tsv_refresh();
--> statement-breakpoint
DROP TRIGGER memory_words ON memory;
--> statement-breakpoint
CREATE TRIGGER memory_words
AFTER INSERT OR UPDATE OF title, capture_note, body, ai_opt_out, search_tsv, source_url, metadata ON memory
FOR EACH ROW EXECUTE FUNCTION memory_words_refresh();
