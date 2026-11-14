-- Category why-chips take priority when browsing with Source or date chips.
-- Otherwise retain the search function from 0029 unchanged.
CREATE OR REPLACE FUNCTION search_memories(
  p_user_id text,
  p_query text,
  p_limit integer DEFAULT 40,
  p_vector halfvec DEFAULT NULL,
  p_like uuid DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_dimensions integer DEFAULT NULL,
  p_max_distance double precision DEFAULT 0.6,
  p_kinds text[] DEFAULT NULL,
  p_filters jsonb DEFAULT '{}',
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  score double precision,
  matched text[],
  distance double precision,
  part jsonb,
  -- Place in the answer (1 first), so callers keep the order the ranking gave.
  place bigint
)
LANGUAGE sql
STABLE
-- `%` reads this: one or two typos pass in words of five letters or more,
-- while near neighbours ("bread", "read") stay apart.
SET pg_trgm.similarity_threshold = 0.4
-- A search is small however big the Library is: compiling it costs more than running it.
SET jit = off
AS $$
  WITH f AS (
    SELECT
      ARRAY(SELECT lower(h) FROM jsonb_array_elements_text(coalesce(p_filters->'hosts', '[]')) h) AS hosts,
      (p_filters->>'after')::timestamptz AS after,
      (p_filters->>'before')::timestamptz AS before,
      -- NULL: any Category. Else a Memory needs one of these.
      CASE WHEN p_filters ? 'categories'
        THEN ARRAY(SELECT jsonb_array_elements_text(p_filters->'categories')) END AS categories,
      p_filters->>'colour' AS must_colour,
      coalesce(p_filters->>'colour', p_filters->>'prefer') AS colour,
      (p_filters->>'cursor')::uuid AS cursor,
      -- Anything to narrow by; without it no row is checked at all.
      p_kinds IS NOT NULL OR p_filters ?| ARRAY['hosts', 'after', 'before', 'colour', 'categories'] AS scoped
  ),
    query_words AS (
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
    FROM memory m
    CROSS JOIN q
    CROSS JOIN f
    WHERE btrim(p_query) <> '' AND m.user_id = p_user_id AND m.search_tsv @@ q.keyword
      AND m.id IS DISTINCT FROM p_like
      AND (NOT f.scoped OR in_scope(m, p_kinds, f.hosts, f.after, f.before, f.must_colour, f.categories))
    ORDER BY rank
    LIMIT 100
  ),
  typo AS (
    SELECT m.id, row_number() OVER (
      ORDER BY ts_rank_cd(m.search_tsv, q.typo) DESC, m.captured_at DESC
    ) AS rank
    FROM memory m
    CROSS JOIN q
    CROSS JOIN f
    WHERE btrim(p_query) <> '' AND m.user_id = p_user_id AND m.search_tsv @@ q.typo
      AND m.id IS DISTINCT FROM p_like
      AND (NOT f.scoped OR in_scope(m, p_kinds, f.hosts, f.after, f.before, f.must_colour, f.categories))
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
      AND v.dimensions = p_dimensions
      AND v.kind IN ('overview', 'visual')
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
      AND (NOT coalesce((p_filters->>'imageQuery')::boolean, false) OR v.kind IN ('visual', 'overview'))
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
    CROSS JOIN f
    WHERE (NOT f.scoped OR in_scope(m, p_kinds, f.hosts, f.after, f.before, f.must_colour, f.categories))
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
      sum(CASE legs.leg WHEN 'typo' THEN 0.5 ELSE 1.0 END / (60 + legs.rank)) AS base,
      array_agg(legs.leg ORDER BY legs.leg) AS matched,
      (array_agg(legs.leg ORDER BY legs.rank, legs.leg))[1] AS best
    FROM legs
    GROUP BY legs.id
  ),
  scored AS (
    SELECT fu.id, fu.matched, fu.best,
      -- Colour moves a Memory up a few places among close matches; it cannot
      -- lift a weak match over a strong one.
      (fu.base + coalesce(c.closeness, 0) * 0.003)::double precision AS score
    FROM fused fu
    CROSS JOIN f
    LEFT JOIN LATERAL colour_match(fu.id, f.colour) c ON f.colour IS NOT NULL
    ORDER BY score DESC, fu.id
    LIMIT greatest(p_limit, 0) OFFSET greatest(p_offset, 0)
  ),
  -- No words and no colour: the filtered Memories, newest first, read off
  -- memory_user_captured_idx and paged by the last Memory's id, so a page
  -- costs the same however deep it is.
  browse_time AS (
    SELECT m.id, m.captured_at AS at,
      jsonb_build_object('kind', 'filter') || CASE
        WHEN f.categories IS NOT NULL THEN jsonb_build_object('field', 'category',
          'value', (SELECT c FROM unnest(m.categories) c WHERE c = ANY (f.categories) LIMIT 1))
        WHEN cardinality(f.hosts) > 0 THEN jsonb_build_object('field', 'source',
          'value', lower(substring(m.source_url from '^https?://(?:[^/?#@]*@)?([^/:?#]+)')))
        WHEN f.after IS NOT NULL OR f.before IS NOT NULL
          THEN jsonb_build_object('field', 'date', 'value', m.captured_at)
        ELSE jsonb_build_object('field', 'kind', 'value', m.kind)
      END AS part
    FROM memory m
    CROSS JOIN f
    -- Gated on the arguments alone, so a search with words never reads this.
    WHERE btrim(p_query) = '' AND p_vector IS NULL AND p_like IS NULL
      AND p_filters->>'colour' IS NULL AND m.user_id = p_user_id
      AND (NOT f.scoped OR in_scope(m, p_kinds, f.hosts, f.after, f.before, NULL, f.categories))
      -- A Memory with a file still uploading is not on the wall yet.
      AND NOT EXISTS (SELECT 1 FROM memory_file mf WHERE mf.memory_id = m.id AND mf.stored_at IS NULL)
      AND (f.cursor IS NULL OR (m.captured_at, m.id) < (
        SELECT c.captured_at, c.id FROM memory c WHERE c.id = f.cursor AND c.user_id = p_user_id))
    ORDER BY m.captured_at DESC NULLS LAST, m.id DESC NULLS LAST
    LIMIT greatest(p_limit, 0) OFFSET greatest(p_offset, 0)
  ),
  -- With a colour: closest first, then newest. Ranked by a value that is
  -- computed per Memory, so this one pages by offset.
  browse_colour AS (
    SELECT m.id, c.closeness AS score, m.captured_at AS at,
      jsonb_build_object('kind', 'filter', 'field', 'colour', 'value', c.hex) AS part
    FROM memory m
    CROSS JOIN f
    CROSS JOIN LATERAL (
      SELECT pal.hex, greatest(0, 1 - d.distance / 0.14) AS closeness
      FROM memory_file mf
      CROSS JOIN LATERAL unnest(mf.palette) AS pal(hex)
      CROSS JOIN LATERAL (SELECT colour_distance(pal.hex, f.must_colour) AS distance) d
      WHERE mf.memory_id = m.id
      ORDER BY d.distance
      LIMIT 1
    ) c
    WHERE btrim(p_query) = '' AND p_vector IS NULL AND p_like IS NULL
      AND p_filters->>'colour' IS NOT NULL AND m.user_id = p_user_id
      AND c.closeness > 0
      AND (NOT f.scoped OR in_scope(m, p_kinds, f.hosts, f.after, f.before, NULL, f.categories))
      AND NOT EXISTS (SELECT 1 FROM memory_file mf WHERE mf.memory_id = m.id AND mf.stored_at IS NULL)
    ORDER BY c.closeness DESC, m.captured_at DESC, m.id DESC
    LIMIT greatest(p_limit, 0) OFFSET greatest(p_offset, 0)
  ),
  ranked AS (
    SELECT f.id, f.score, f.matched, v.distance, NULL::timestamptz AS at,
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
  FROM scored f
  JOIN memory m ON m.id = f.id AND m.user_id = p_user_id
  LEFT JOIN vector v ON v.id = f.id
  CROSS JOIN q
  CROSS JOIN LATERAL (
    SELECT CASE f.best WHEN 'keyword' THEN q.any_word ELSE q.typo END AS query
  ) wq
  CROSS JOIN LATERAL (
    SELECT wq.query, CASE WHEN f.best <> 'vector' THEN matched_field(m, wq.query) END AS field
  ) w
    UNION ALL
    SELECT b.id, 0::double precision, ARRAY['filter']::text[], NULL::double precision, b.at, b.part
    FROM browse_time b
    UNION ALL
    SELECT b.id, b.score, ARRAY['filter']::text[], NULL::double precision, b.at, b.part
    FROM browse_colour b
  )
  SELECT r.id, r.score, r.matched, r.distance, r.part,
    -- Ranked results tie by id; browsing (it has a time) ends ties newest id first, as it pages.
    row_number() OVER (
      ORDER BY r.score DESC, r.at DESC NULLS LAST, CASE WHEN r.at IS NULL THEN r.id END, r.id DESC
    ) AS place
  FROM ranked r
  ORDER BY place
$$;

