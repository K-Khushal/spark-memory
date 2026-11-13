-- Custom Categories (#25, ADR-0008). A Memory's Categories are the built-in
-- names plus the owner's own: a CHECK cannot read another table, so a trigger
-- holds that rule and the CHECK keeps the shape (one to three, no NULL).
-- Additive and data-preserving: every stored Category is built-in today.
CREATE FUNCTION builtin_categories() RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT ARRAY['Article','Video','Social Post','Design Reference','Screenshot','Product','Recipe','Place','Receipt or Document','Code','Tutorial','Quote','Idea','Other']
$$;
--> statement-breakpoint
-- A built-in's name in any case: a custom Category may not shadow one.
CREATE FUNCTION is_builtin_category(name text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(name) = ANY (SELECT lower(b) FROM unnest(builtin_categories()) b)
$$;
--> statement-breakpoint
CREATE TABLE category (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT category_name_valid CHECK (
    name = btrim(name) AND char_length(name) BETWEEN 1 AND 40
    -- Never a built-in's name, in any case.
    AND NOT is_builtin_category(name)
  )
);
--> statement-breakpoint
-- One name per person, whatever its case.
CREATE UNIQUE INDEX category_user_name_idx ON category (user_id, lower(name));
--> statement-breakpoint
ALTER TABLE memory DROP CONSTRAINT memory_categories_valid;
--> statement-breakpoint
ALTER TABLE memory ADD CONSTRAINT memory_categories_valid CHECK (
  cardinality(categories) BETWEEN 1 AND 3 AND array_position(categories, NULL) IS NULL
);
--> statement-breakpoint
CREATE FUNCTION memory_categories_known() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Share-lock the rows relied on: a Category deleted or renamed at the same
  -- moment is waited for, so the name written is one that still exists.
  PERFORM 1 FROM category k WHERE k.user_id = NEW.user_id AND k.name = ANY (NEW.categories) FOR SHARE;
  IF EXISTS (
    SELECT 1 FROM unnest(NEW.categories) c
    WHERE c <> ALL (builtin_categories())
      AND NOT EXISTS (SELECT 1 FROM category k WHERE k.user_id = NEW.user_id AND k.name = c)
  ) THEN
    RAISE EXCEPTION 'unknown category' USING ERRCODE = 'check_violation', CONSTRAINT = 'memory_categories_known';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER memory_categories_known
  BEFORE INSERT OR UPDATE OF categories, user_id ON memory
  FOR EACH ROW EXECUTE FUNCTION memory_categories_known();
--> statement-breakpoint
-- Re-categorising after a Category is created. `generation` goes up whenever
-- the person's Categories change (create, rename, delete): a worker that
-- loaded the list at an older one is refused when it writes. `due_generation`
-- is the one a Category was last created at: a Memory categorised under an
-- older one is due again. `total` is how many Memories were due when it began;
-- how many are left is read from the Memories themselves.
CREATE TABLE category_run (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  generation integer NOT NULL DEFAULT 0,
  due_generation integer NOT NULL DEFAULT 0,
  total integer NOT NULL DEFAULT 0 CHECK (total >= 0),
  started_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- The generation of the Categories a Memory was categorised under; null before any.
ALTER TABLE memory ADD COLUMN categories_generation integer;
