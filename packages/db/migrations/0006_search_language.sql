-- Language-aware keyword index over a Memory's own text and what Indexing
-- found (#7). search_tsv stops being a generated column (0005 dropped its
-- expression, keeping every value) and is written by triggers instead,
-- because it now reads a second table. search_memories (0003) is unchanged.

-- The text search configuration for a BCP-47 tag (configs shipped with
-- Postgres 16 and 17). No language yet, which includes every Memory with AI
-- opt-out, keeps English as before; a language Postgres has no stemmer for
-- reads its words as written ('simple').
CREATE FUNCTION search_config(p_language text) RETURNS regconfig
LANGUAGE sql IMMUTABLE AS $$
  SELECT (CASE lower(split_part(coalesce(p_language, ''), '-', 1))
    WHEN '' THEN 'english' WHEN 'en' THEN 'english'
    WHEN 'ar' THEN 'arabic' WHEN 'hy' THEN 'armenian' WHEN 'eu' THEN 'basque'
    WHEN 'ca' THEN 'catalan' WHEN 'da' THEN 'danish' WHEN 'nl' THEN 'dutch'
    WHEN 'fi' THEN 'finnish' WHEN 'fr' THEN 'french' WHEN 'de' THEN 'german'
    WHEN 'el' THEN 'greek' WHEN 'hi' THEN 'hindi' WHEN 'hu' THEN 'hungarian'
    WHEN 'id' THEN 'indonesian' WHEN 'ga' THEN 'irish' WHEN 'it' THEN 'italian'
    WHEN 'lt' THEN 'lithuanian' WHEN 'ne' THEN 'nepali' WHEN 'no' THEN 'norwegian'
    WHEN 'nb' THEN 'norwegian' WHEN 'nn' THEN 'norwegian' WHEN 'pt' THEN 'portuguese'
    WHEN 'ro' THEN 'romanian' WHEN 'ru' THEN 'russian' WHEN 'sr' THEN 'serbian'
    WHEN 'es' THEN 'spanish' WHEN 'sv' THEN 'swedish' WHEN 'ta' THEN 'tamil'
    WHEN 'tr' THEN 'turkish' WHEN 'yi' THEN 'yiddish'
    ELSE 'simple' END)::regconfig
$$;
--> statement-breakpoint

-- A Memory's searchable text by weight: A titles, B Capture note, Tags and
-- entities, C text, description and text in the image. What Indexing found
-- counts only without AI opt-out.
CREATE FUNCTION memory_texts(p_memory memory, OUT a text, OUT b text, OUT c text)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  found memory_index;
BEGIN
  IF NOT p_memory.ai_opt_out THEN
    SELECT * INTO found FROM memory_index WHERE memory_id = p_memory.id;
  END IF;
  a := concat_ws(' ', p_memory.title, found.title);
  b := concat_ws(' ', p_memory.capture_note,
    array_to_string(found.tags, ' '), array_to_string(found.entities, ' '));
  c := concat_ws(' ', p_memory.body, found.description, found.ocr_text);
END $$;
--> statement-breakpoint

CREATE FUNCTION memory_document(p_memory memory) RETURNS tsvector
LANGUAGE plpgsql STABLE AS $$
DECLARE
  cfg regconfig := search_config(p_memory.language);
  t record := memory_texts(p_memory);
  doc tsvector;
BEGIN
  doc := setweight(to_tsvector(cfg, t.a), 'A')
    || setweight(to_tsvector(cfg, t.b), 'B')
    || setweight(to_tsvector(cfg, t.c), 'C');
  -- search_memories reads queries as English: for another language, the
  -- words as written match too.
  IF cfg NOT IN ('english'::regconfig, 'simple'::regconfig) THEN
    doc := doc || setweight(to_tsvector('simple', t.a), 'A')
      || setweight(to_tsvector('simple', t.b), 'B')
      || setweight(to_tsvector('simple', t.c), 'C');
  END IF;
  RETURN doc;
END $$;
--> statement-breakpoint

CREATE FUNCTION memory_search_tsv_refresh() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_tsv := memory_document(NEW);
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Setting search_tsv (to anything) recomputes it: memory_index's trigger does that.
CREATE TRIGGER memory_search_tsv
BEFORE INSERT OR UPDATE OF title, capture_note, body, language, ai_opt_out, search_tsv ON memory
FOR EACH ROW EXECUTE FUNCTION memory_search_tsv_refresh();
--> statement-breakpoint

CREATE FUNCTION memory_index_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE memory SET search_tsv = NULL
  WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.memory_id ELSE NEW.memory_id END;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER memory_index_changed
AFTER INSERT OR UPDATE OR DELETE ON memory_index
FOR EACH ROW EXECUTE FUNCTION memory_index_changed();
--> statement-breakpoint

-- Typo matching (memory_word, 0003) learns the words Indexing found too.
CREATE OR REPLACE FUNCTION memory_words_refresh() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  t record := memory_texts(NEW);
BEGIN
  DELETE FROM memory_word WHERE memory_id = NEW.id;
  INSERT INTO memory_word (memory_id, user_id, word)
  SELECT DISTINCT NEW.id, NEW.user_id, w.lexeme
  FROM unnest(to_tsvector('simple', concat_ws(' ', t.a, t.b, t.c))) AS w
  WHERE char_length(w.lexeme) BETWEEN 3 AND 40;
  RETURN NULL;
END $$;
--> statement-breakpoint
DROP TRIGGER memory_words ON memory;
--> statement-breakpoint
CREATE TRIGGER memory_words
AFTER INSERT OR UPDATE OF title, capture_note, body, ai_opt_out, search_tsv ON memory
FOR EACH ROW EXECUTE FUNCTION memory_words_refresh();
--> statement-breakpoint

UPDATE memory SET search_tsv = NULL;
