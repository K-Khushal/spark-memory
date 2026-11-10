-- Instant search (PLAN.md §6.2, ADR-0004): a keyword leg (tsvector, every word
-- also matching as a prefix, so results follow each keystroke) and a typo leg
-- (pg_trgm word similarity), fused with Reciprocal Rank Fusion (k = 60). Always
-- inside one Library. The vector legs (Overview, Visual, Passage) join here as
-- more CTEs later. `matched` names the legs that found each Memory.
CREATE OR REPLACE FUNCTION search_memories(
  p_user_id text,
  p_query text,
  p_limit integer DEFAULT 40
)
RETURNS TABLE (id uuid, score double precision, matched text[])
LANGUAGE sql
STABLE
-- `<%` reads this threshold; 0.4 lets one or two typos in a word through.
SET pg_trgm.word_similarity_threshold = 0.4
AS $$
  WITH q AS (
    SELECT
      -- Words as the keyword index stems them, each quoted and matched as a
      -- prefix. Building the tsquery from lexemes means no input can break it.
      (
        SELECT to_tsquery('simple', string_agg(
          '''' || replace(replace(t.lexeme, '\', '\\'), '''', '\''') || ''':*',
          ' & '
        ))
        FROM unnest(to_tsvector('english', p_query)) AS t
      ) AS tsq,
      lower(btrim(p_query)) AS text
  ),
  keyword AS (
    SELECT m.id, row_number() OVER (
      ORDER BY ts_rank_cd(m.search_tsv, q.tsq) DESC, m.captured_at DESC
    ) AS rank
    FROM memory m, q
    WHERE m.user_id = p_user_id AND m.search_tsv @@ q.tsq
    ORDER BY rank
    LIMIT 100
  ),
  typo AS (
    SELECT m.id, row_number() OVER (
      ORDER BY word_similarity(q.text, m.search_text) DESC, m.captured_at DESC
    ) AS rank
    FROM memory m, q
    -- Under 3 characters every word looks alike; the prefix leg covers it.
    WHERE m.user_id = p_user_id
      AND char_length(q.text) >= 3
      AND q.text <% m.search_text
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
