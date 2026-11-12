-- #12: search filters apply before each ranking leg; colour adds at most 0.003 RRF points.
-- A search with no filter reads the Library exactly as before: nothing is built per Memory.
CREATE FUNCTION colour_distance(a text, b text) RETURNS double precision
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  -- "Redmean" weighting of RGB, scaled so black to white is 1.
  SELECT CASE WHEN a ~ '^#[0-9a-fA-F]{6}$' AND b ~ '^#[0-9a-fA-F]{6}$' THEN (
    SELECT sqrt(
      (2 + (x.r1 + x.r2) / 512.0) * power(x.r1 - x.r2, 2)
      + 4 * power(x.g1 - x.g2, 2)
      + (2 + (510 - x.r1 - x.r2) / 512.0) * power(x.b1 - x.b2, 2)
    ) / 764.83
    FROM (SELECT
      ('x' || substr(a, 2, 2))::bit(8)::int AS r1, ('x' || substr(b, 2, 2))::bit(8)::int AS r2,
      ('x' || substr(a, 4, 2))::bit(8)::int AS g1, ('x' || substr(b, 4, 2))::bit(8)::int AS g2,
      ('x' || substr(a, 6, 2))::bit(8)::int AS b1, ('x' || substr(b, 6, 2))::bit(8)::int AS b2
    ) x
  ) ELSE 1 END
$$;
--> statement-breakpoint
-- The palette colour of a Memory nearest to p_colour, and how close (1 is exact, 0 is 0.14 or more away).
CREATE FUNCTION colour_match(p_memory uuid, p_colour text)
RETURNS TABLE (closeness double precision, hex text)
LANGUAGE sql STABLE COST 20 ROWS 1 AS $$
  SELECT greatest(0, 1 - d.distance / 0.14), pal.hex
  FROM memory_file mf
  CROSS JOIN LATERAL unnest(mf.palette) AS pal(hex)
  CROSS JOIN LATERAL (SELECT colour_distance(pal.hex, p_colour) AS distance) d
  WHERE mf.memory_id = p_memory
  ORDER BY d.distance
  LIMIT 1
$$;
--> statement-breakpoint
-- The host of a URL and each parent domain above it: www.instagram.com is
-- {www.instagram.com, instagram.com}. A Source filter matches any of them,
-- so "instagram.com" takes "www.instagram.com" and not "instagram.com.evil.test".
CREATE FUNCTION host_chain(p_url text) RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(
    ARRAY(
      SELECT array_to_string(x.parts[i:], '.')
      FROM (SELECT string_to_array(
        lower(substring(p_url from '^https?://(?:[^/?#@]*@)?([^/:?#]+)')), '.') AS parts) x,
        generate_series(1, coalesce(cardinality(x.parts), 0) - 1) i
    ),
    '{}')
$$;
--> statement-breakpoint
CREATE FUNCTION colour_near(p_memory uuid, p_colour text) RETURNS boolean
LANGUAGE sql STABLE COST 20 AS $$
  SELECT EXISTS (SELECT 1 FROM colour_match(p_memory, p_colour) c WHERE c.closeness > 0)
$$;
--> statement-breakpoint
-- Whether a Memory passes a search's filters (NULL and empty mean no filter).
-- Plain expressions, so a search inlines it and checks no more than it must.
CREATE FUNCTION in_scope(
  m memory, p_kinds text[], p_hosts text[], p_after timestamptz, p_before timestamptz, p_colour text
) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT (p_kinds IS NULL OR m.kind = ANY (p_kinds))
    AND (p_after IS NULL OR m.captured_at >= p_after)
    AND (p_before IS NULL OR m.captured_at < p_before)
    AND (cardinality(p_hosts) = 0 OR p_hosts && host_chain(m.source_url))
    AND (p_colour IS NULL OR colour_near(m.id, p_colour))
$$;
--> statement-breakpoint
DROP FUNCTION search_memories(text, text, integer, halfvec, uuid, text, integer, double precision, text[]);
--> statement-breakpoint
-- p_filters: hosts (Source), after / before (when captured), colour (a palette
-- must be near it) or prefer (near it ranks higher, nothing is left out), and
-- cursor (browsing with no words: the id of the last Memory of the page before).
CREATE FUNCTION search_memories(
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
      p_filters->>'colour' AS must_colour,
      coalesce(p_filters->>'colour', p_filters->>'prefer') AS colour,
      (p_filters->>'cursor')::uuid AS cursor,
      -- Anything to narrow by; without it no row is checked at all.
      p_kinds IS NOT NULL OR p_filters ?| ARRAY['hosts', 'after', 'before', 'colour'] AS scoped
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
      AND (NOT f.scoped OR in_scope(m, p_kinds, f.hosts, f.after, f.before, f.must_colour))
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
      AND (NOT f.scoped OR in_scope(m, p_kinds, f.hosts, f.after, f.before, f.must_colour))
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
    CROSS JOIN f
    WHERE (NOT f.scoped OR in_scope(m, p_kinds, f.hosts, f.after, f.before, f.must_colour))
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
      AND (NOT f.scoped OR in_scope(m, p_kinds, f.hosts, f.after, f.before, NULL))
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
      AND (NOT f.scoped OR in_scope(m, p_kinds, f.hosts, f.after, f.before, NULL))
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
--> statement-breakpoint
CREATE TABLE recent_search (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 query text NOT NULL CHECK (char_length(query) BETWEEN 1 AND 500),
 searched_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id, query)
);
--> statement-breakpoint
CREATE TABLE search_event (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 query text NOT NULL CHECK (char_length(query) BETWEEN 0 AND 500),
 memory_id uuid REFERENCES memory(id) ON DELETE SET NULL,
 position integer CHECK (position BETWEEN 1 AND 100),
 reformulation boolean NOT NULL DEFAULT false,
 occurred_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX search_event_owner_time ON search_event(user_id, occurred_at);
--> statement-breakpoint
CREATE INDEX recent_search_expiry ON recent_search(searched_at);
--> statement-breakpoint
CREATE INDEX search_event_expiry ON search_event(occurred_at);
