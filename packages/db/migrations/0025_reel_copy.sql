-- A reel's user-provided copy (#20, ADR-0010): the video the person's own
-- browser fetched and a few frames from it, kept only until Indexing has
-- made the transcript and Visual vectors, then deleted. Its own table, not
-- memory_file: an unfinished copy must never hide the reel from the wall,
-- count as an abandoned upload, or outlive Indexing.

CREATE TABLE "memory_copy" (
  "memory_id" uuid NOT NULL REFERENCES "memory"("id") ON DELETE CASCADE,
  "role" text NOT NULL,
  "seq" integer DEFAULT 0 NOT NULL,
  "generation" uuid DEFAULT gen_random_uuid() NOT NULL,
  "r2_key" text NOT NULL,
  "mime" text NOT NULL,
  "bytes" integer NOT NULL,
  -- The video's length, or a frame's moment.
  "seconds" double precision,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "stored_at" timestamp with time zone,
  CONSTRAINT "memory_copy_pk" PRIMARY KEY ("memory_id", "role", "seq"),
  CONSTRAINT "memory_copy_key_unique" UNIQUE ("r2_key")
);--> statement-breakpoint
CREATE INDEX "memory_copy_created_idx" ON "memory_copy" USING btree ("created_at");--> statement-breakpoint

-- However a copy's row goes (dropped after Indexing, replaced, swept, or with
-- its Memory or account), its object is queued for removal. A PUT that has
-- not finished may still land, so its removal waits out the upload URL.
CREATE FUNCTION memory_copy_removed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO object_removal (key, due_at)
  VALUES (OLD.r2_key, CASE WHEN OLD.stored_at IS NULL
    THEN clock_timestamp() + interval '15 minutes' ELSE now() END)
  ON CONFLICT DO NOTHING;
  RETURN OLD;
END $$;--> statement-breakpoint
CREATE TRIGGER memory_copy_removed AFTER DELETE ON "memory_copy"
  FOR EACH ROW EXECUTE FUNCTION memory_copy_removed();
