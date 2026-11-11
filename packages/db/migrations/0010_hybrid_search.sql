-- Hybrid search (ADR-0004, #8): the vector leg joins 0003's keyword and typo
-- legs in the same function, and each result says which part matched.

-- A row's vector is as long as it says.
ALTER TABLE memory_vector ADD CONSTRAINT memory_vector_dimensions
  CHECK (vector_dims(embedding) = dimensions);
--> statement-breakpoint

-- Whether `p_text` has a word of `p_query`, read as the Memory's language and as written.
CREATE FUNCTION text_matches(p_config regconfig, p_text text, p_query tsquery)
RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT (to_tsvector(p_config, coalesce(p_text, ''))
    || to_tsvector('simple', coalesce(p_text, ''))) @@ p_query
$$;
--> statement-breakpoint

-- The strongest field of a Memory holding a word of `p_query`: title, note,
-- tags (and entities), text, ocr or description; null when none does. The
-- weights of search_tsv (0006) narrow it down without reading the text
-- again; a short field settles the rest. A text Memory's description only
-- retells its text, so a word in either is "text".
CREATE FUNCTION matched_field(p_memory memory, p_query tsquery) RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE
  cfg regconfig := search_config(p_memory.language);
  ocr text;
BEGIN
  IF p_query IS NULL THEN RETURN NULL; END IF;
  IF ts_filter(p_memory.search_tsv, '{a}') @@ p_query THEN RETURN 'title'; END IF;
  IF ts_filter(p_memory.search_tsv, '{b}') @@ p_query THEN
    RETURN CASE WHEN text_matches(cfg, p_memory.capture_note, p_query)
      THEN 'note' ELSE 'tags' END;
  END IF;
  IF NOT ts_filter(p_memory.search_tsv, '{c}') @@ p_query THEN RETURN NULL; END IF;
  IF p_memory.kind = 'text' THEN RETURN 'text'; END IF;
  SELECT i.ocr_text INTO ocr FROM memory_index i WHERE i.memory_id = p_memory.id;
  RETURN CASE WHEN text_matches(cfg, left(ocr, 20000), p_query)
    THEN 'ocr' ELSE 'description' END;
END $$;
--> statement-breakpoint

DROP FUNCTION search_memories(text, text, integer);
--> statement-breakpoint

-- Three legs fused with Reciprocal Rank Fusion (k = 60), always inside one
-- Library, optionally only some kinds of Memory. A typo correction is a
-- guess ("temple" also reads as "tempo"), so that leg counts half. `matched` names the legs
-- that found each Memory; `distance` is its closest vector's; `part` is what
-- matched in the leg that ranked it highest:
--   {"kind": "field", "field": "title" | "note" | "tags" | "text" | "ocr" | "description"}
--   {"kind": "passage", "field": "body" | "ocr", "start": n, "end": n}
--   {"kind": "overview"} or {"kind": "visual"}
--   keyword: every query word, each also as a prefix, so results follow
--            each keystroke.
--   typo:    each query word corrected to similar words in this Library
--            (pg_trgm), then those looked up in the keyword index.
--   vector:  each Memory's closest vector to the query's, by an exact scan
--            of this Library's vectors in one space (`p_model`,
--            `p_dimensions`), no further than `p_max_distance`. The query's
--            vectors are `p_vector` (the query text's) or, for More Like
--            This, the Overview and Visual of Memory `p_like`, which is left
--            out of the results. Without either the leg finds nothing.
CREATE FUNCTION search_memories(
  p_user_id text,
  p_query text,
  p_limit integer DEFAULT 40,
  p_vector halfvec DEFAULT NULL,
  p_like uuid DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_dimensions integer DEFAULT NULL,
  p_max_distance double precision DEFAULT 0.6,
  p_kinds text[] DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  score double precision,
  matched text[],
  distance double precision,
  part jsonb
)
LANGUAGE sql
STABLE
-- `%` reads this: one or two typos pass in words of five letters or more,
-- while near neighbours ("bread", "read") stay apart.
SET pg_trgm.similarity_threshold = 0.4
AS $$
  WITH query_words AS (
    SELECT t.lexeme AS word
    FROM unnest(to_tsvector('simple', p_query)) AS t
    -- Under 3 characters every word looks alike; the prefix covers it.
    WHERE char_length(t.lexeme) BETWEEN 3 AND 40
  ),
  -- The three closest words in this Library for each query word.
  corrections AS (
    SELECT DISTINCT c.word
    FROM query_words q
    CROSS JOIN LATERAL (
      SELECT w.word
      FROM memory_word w
      WHERE w.user_id = p_user_id AND w.word % q.word AND w.word <> q.word
      GROUP BY w.word
      ORDER BY similarity(w.word, q.word) DESC
      LIMIT 3
    ) AS c
  ),
  q AS (
    SELECT
      -- A query of only stop words ("a", the first letter of "apple") still
      -- matches as a prefix, through the simple config.
      coalesce(
        lexeme_tsquery(p_query, 'english', ' & ', ':*'),
        lexeme_tsquery(p_query, 'simple', ' & ', ':*')
      ) AS keyword,
      -- Any one query word: to say which field matched.
      coalesce(
        lexeme_tsquery(p_query, 'english', ' | ', ':*'),
        lexeme_tsquery(p_query, 'simple', ' | ', ':*')
      ) AS any_word,
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
      AND (p_kinds IS NULL OR m.kind = ANY (p_kinds))
    ORDER BY rank
    LIMIT 100
  ),
  typo AS (
    SELECT m.id, row_number() OVER (
      ORDER BY ts_rank_cd(m.search_tsv, q.typo) DESC, m.captured_at DESC
    ) AS rank
    FROM memory m, q
    WHERE m.user_id = p_user_id AND m.search_tsv @@ q.typo
      AND (p_kinds IS NULL OR m.kind = ANY (p_kinds))
    ORDER BY rank
    LIMIT 100
  ),
  -- Once, not per row it is compared with.
  probe AS MATERIALIZED (
    SELECT p_vector AS v
    WHERE p_vector IS NOT NULL AND vector_dims(p_vector) = p_dimensions
    UNION ALL
    SELECT v.embedding
    FROM memory_vector v
    WHERE p_like IS NOT NULL AND v.memory_id = p_like
      AND v.user_id = p_user_id AND v.model = p_model
      AND v.dimensions = p_dimensions AND v.kind IN ('overview', 'visual')
  ),
  nearest AS (
    SELECT DISTINCT ON (v.memory_id)
      v.memory_id AS id, v.kind, v.anchor, d.distance
    FROM memory_vector v
    CROSS JOIN LATERAL (
      SELECT min(v.embedding <=> p.v) AS distance FROM probe p
    ) AS d
    WHERE v.user_id = p_user_id AND v.model = p_model
      AND v.dimensions = p_dimensions
      AND v.memory_id IS DISTINCT FROM p_like
      AND d.distance <= p_max_distance
    ORDER BY v.memory_id, d.distance
  ),
  vector AS (
    SELECT n.id, n.kind, n.anchor, n.distance,
      row_number() OVER (ORDER BY n.distance, n.id) AS rank
    FROM nearest n
    JOIN memory m ON m.id = n.id
    WHERE p_kinds IS NULL OR m.kind = ANY (p_kinds)
    ORDER BY rank
    LIMIT 100
  ),
  legs AS (
    SELECT keyword.id, keyword.rank, 'keyword' AS leg FROM keyword
    UNION ALL
    SELECT typo.id, typo.rank, 'typo' AS leg FROM typo
    UNION ALL
    SELECT vector.id, vector.rank, 'vector' AS leg FROM vector
  ),
  fused AS (
    SELECT legs.id,
      sum(CASE legs.leg WHEN 'typo' THEN 0.5 ELSE 1.0 END / (60 + legs.rank))::double precision AS score,
      array_agg(legs.leg ORDER BY legs.leg) AS matched,
      (array_agg(legs.leg ORDER BY legs.rank, legs.leg))[1] AS best
    FROM legs
    GROUP BY legs.id
    ORDER BY score DESC, legs.id
    LIMIT p_limit
  )
  SELECT f.id, f.score, f.matched, v.distance,
    CASE
      WHEN f.best = 'vector' AND v.kind = 'passage'
        THEN jsonb_build_object('kind', 'passage') || v.anchor
      WHEN f.best = 'vector' THEN jsonb_build_object('kind', v.kind)
      ELSE jsonb_strip_nulls(jsonb_build_object('kind', 'field', 'field',
        matched_field(m, CASE f.best WHEN 'keyword' THEN q.any_word ELSE q.typo END)))
    END AS part
  FROM fused f
  JOIN memory m ON m.id = f.id
  LEFT JOIN vector v ON v.id = f.id
  CROSS JOIN q
  ORDER BY f.score DESC, f.id
$$;
