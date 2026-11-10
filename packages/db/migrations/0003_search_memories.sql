-- Instant search (PLAN.md §6.2, ADR-0004), hand-written so the vector legs
-- (Overview, Visual, Passage) can join it later as more CTEs.

-- memory_word holds each Memory's distinct words for typo matching. The
-- trigger keeps it in step with the text on every Capture and edit; rows go
-- with their Memory (foreign key, on delete cascade).
CREATE FUNCTION memory_words_refresh() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM memory_word WHERE memory_id = NEW.id;
  INSERT INTO memory_word (memory_id, user_id, word)
  SELECT NEW.id, NEW.user_id, t.lexeme
  FROM unnest(to_tsvector('simple', concat_ws(' ', NEW.title, NEW.capture_note, NEW.body))) AS t
  WHERE char_length(t.lexeme) BETWEEN 3 AND 40;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER memory_words AFTER INSERT OR UPDATE OF title, capture_note, body ON memory
FOR EACH ROW EXECUTE FUNCTION memory_words_refresh();
--> statement-breakpoint

-- The words of `p_text` as `p_config` reads them, quoted and joined into a
-- tsquery. Built from lexemes, so no input can make it a syntax error.
CREATE FUNCTION lexeme_tsquery(p_text text, p_config regconfig, p_join text, p_suffix text)
RETURNS tsquery
LANGUAGE sql IMMUTABLE AS $$
  SELECT to_tsquery('simple', string_agg(
    '''' || replace(replace(t.lexeme, '\', '\\'), '''', '\''') || '''' || p_suffix,
    p_join
  ))
  FROM unnest(to_tsvector(p_config, p_text)) AS t
$$;
--> statement-breakpoint

-- Two legs, fused with Reciprocal Rank Fusion (k = 60), always inside one
-- Library. `matched` names the legs that found each Memory.
--   keyword: every query word, each also as a prefix, so results follow
--            each keystroke.
--   typo:    each query word corrected to similar words in this Library
--            (pg_trgm), then those looked up in the keyword index.
CREATE FUNCTION search_memories(p_user_id text, p_query text, p_limit integer DEFAULT 40)
RETURNS TABLE (id uuid, score double precision, matched text[])
LANGUAGE sql
STABLE
-- `%` reads this; 0.35 lets a typo or two through in words of five or more.
SET pg_trgm.similarity_threshold = 0.35
AS $$
  WITH query_words AS (
    SELECT t.lexeme AS word
    FROM unnest(to_tsvector('simple', p_query)) AS t
    -- Under 3 characters every word looks alike; the prefix covers it.
    WHERE char_length(t.lexeme) BETWEEN 3 AND 40
  ),
  corrections AS (
    SELECT DISTINCT w.word
    FROM query_words q
    JOIN memory_word w ON w.word % q.word AND w.word <> q.word
    WHERE w.user_id = p_user_id
  ),
  q AS (
    SELECT
      lexeme_tsquery(p_query, 'english', ' & ', ':*') AS keyword,
      lexeme_tsquery(
        (SELECT string_agg(word, ' ') FROM corrections), 'english', ' | ', ''
      ) AS typo
  ),
  keyword AS (
    SELECT m.id, row_number() OVER (
      ORDER BY ts_rank_cd(m.search_tsv, q.keyword) DESC, m.captured_at DESC
    ) AS rank
    FROM memory m, q
    WHERE m.user_id = p_user_id AND m.search_tsv @@ q.keyword
    ORDER BY rank
    LIMIT 100
  ),
  typo AS (
    SELECT m.id, row_number() OVER (
      ORDER BY ts_rank_cd(m.search_tsv, q.typo) DESC, m.captured_at DESC
    ) AS rank
    FROM memory m, q
    WHERE m.user_id = p_user_id AND m.search_tsv @@ q.typo
    ORDER BY rank
    LIMIT 100
  ),
  legs AS (
    SELECT keyword.id, keyword.rank, 'keyword' AS leg FROM keyword
    UNION ALL
    SELECT typo.id, typo.rank, 'typo' AS leg FROM typo
  )
  SELECT legs.id, sum(1.0 / (60 + legs.rank))::double precision AS score,
    array_agg(legs.leg ORDER BY legs.leg) AS matched
  FROM legs
  GROUP BY legs.id
  ORDER BY score DESC
  LIMIT p_limit
$$;
