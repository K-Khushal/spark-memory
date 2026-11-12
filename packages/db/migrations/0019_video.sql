-- Video transcript anchors (#19). Metadata and vector anchors already use jsonb.
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
    IF p_memory.kind IN ('link', 'video') AND text_matches(cfg, memory_source_text(p_memory), p_query)
      THEN RETURN 'source'; END IF;
    RETURN 'tags';
  END IF;
  IF NOT ts_filter(p_memory.search_tsv, '{c}') @@ p_query THEN RETURN NULL; END IF;
  IF p_memory.kind = 'text' THEN RETURN 'text'; END IF;
  IF p_memory.kind = 'pdf' THEN RETURN 'pdf'; END IF;
  IF p_memory.kind = 'video' THEN RETURN 'video'; END IF;
  IF p_memory.kind IN ('link', 'video') THEN
    RETURN CASE WHEN text_matches(cfg, left(p_memory.body, 20000), p_query)
      THEN 'text' ELSE 'description' END;
  END IF;
  SELECT i.ocr_text INTO ocr FROM memory_index i WHERE i.memory_id = p_memory.id;
  RETURN CASE WHEN text_matches(cfg, left(ocr, 20000), p_query)
    THEN 'ocr' ELSE 'description' END;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION video_part(p_memory memory, p_query tsquery) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
  segment jsonb;
  position integer := 0;
  words text;
  units integer;
BEGIN
  FOR segment IN SELECT value FROM jsonb_array_elements(coalesce(p_memory.metadata->'video'->'transcript', '[]'::jsonb)) LOOP
    words := segment->>'text';
    -- Anchors use JavaScript UTF-16 offsets, including emoji pairs.
    units := char_length(regexp_replace(words, U&'[\+010000-\+10FFFF]', 'xx', 'g'));
    IF text_matches(search_config(p_memory.language), words, p_query) THEN
      RETURN jsonb_build_object('kind', 'passage', 'field', 'body', 'start', position,
        'end', position + units, 'seconds', (segment->>'seconds')::numeric);
    END IF;
    position := position + units + 1;
  END LOOP;
  RETURN jsonb_build_object('kind', 'field', 'field', 'description');
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION search_memories(
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
    -- The owner is read from memory, never only from the vector row.
    JOIN memory pm ON pm.id = v.memory_id AND pm.user_id = p_user_id
    WHERE p_like IS NOT NULL AND v.memory_id = p_like
      AND v.user_id = p_user_id AND v.model = p_model
      AND v.dimensions = p_dimensions AND v.kind IN ('overview', 'visual')
  ),
  nearest AS (
    SELECT DISTINCT ON (v.memory_id)
      v.memory_id AS id, v.kind, v.anchor, d.distance
    FROM memory_vector v
    JOIN memory vm ON vm.id = v.memory_id AND vm.user_id = p_user_id
    CROSS JOIN LATERAL (
      SELECT min(v.embedding <=> p.v) AS distance FROM probe p
    ) AS d
    WHERE v.user_id = p_user_id AND v.model = p_model
      AND v.dimensions = p_dimensions
      AND v.memory_id IS DISTINCT FROM p_like
      AND d.distance <= p_max_distance
    -- Equally close (a short text's Passage often says what its Overview
    -- does): the Overview, then a Visual, then a Passage; within a kind the
    -- first page, then the first place, never by row order. Rows still tied
    -- have the same kind and anchor, so they report the same part.
    ORDER BY v.memory_id, d.distance,
      CASE v.kind WHEN 'overview' THEN 0 WHEN 'visual' THEN 1 ELSE 2 END,
      (v.anchor->>'page')::int NULLS FIRST,
      (v.anchor->>'start')::int NULLS FIRST,
      v.anchor::text NULLS FIRST
  ),
  vector AS (
    SELECT n.id, n.kind, n.anchor, n.distance,
      row_number() OVER (ORDER BY n.distance, n.id) AS rank
    FROM nearest n
    JOIN memory m ON m.id = n.id AND m.user_id = p_user_id
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
      -- A PDF page's Visual says which page.
      WHEN f.best = 'vector'
        THEN jsonb_build_object('kind', v.kind) || coalesce(v.anchor, '{}')
      WHEN w.field = 'pdf' THEN pdf_part(m, w.query)
      WHEN w.field = 'video' THEN video_part(m, w.query)
      ELSE jsonb_strip_nulls(jsonb_build_object('kind', 'field', 'field', w.field))
    END AS part
  FROM fused f
  JOIN memory m ON m.id = f.id AND m.user_id = p_user_id
  LEFT JOIN vector v ON v.id = f.id
  CROSS JOIN q
  CROSS JOIN LATERAL (
    SELECT CASE f.best WHEN 'keyword' THEN q.any_word ELSE q.typo END AS query
  ) wq
  CROSS JOIN LATERAL (
    SELECT wq.query, CASE WHEN f.best <> 'vector' THEN matched_field(m, wq.query) END AS field
  ) w
  ORDER BY f.score DESC, f.id
$$;
