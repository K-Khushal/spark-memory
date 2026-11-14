-- SEC-1: anonymous OAuth registrations expire unless a grant claims them.
ALTER TABLE "assistant_client" ADD COLUMN "claimed_at" timestamp with time zone;
--> statement-breakpoint
-- Every registration that already has a grant, token, code or activity is in use.
UPDATE "assistant_client" c SET "claimed_at" = c."created_at"
WHERE EXISTS (SELECT 1 FROM "assistant_grant" g WHERE g."client_id" = c."id")
   OR EXISTS (SELECT 1 FROM "assistant_token" t WHERE t."client_id" = c."id")
   OR EXISTS (SELECT 1 FROM "assistant_code" k WHERE k."client_id" = c."id")
   OR EXISTS (SELECT 1 FROM "assistant_activity" a WHERE a."client_id" = c."id");
--> statement-breakpoint
-- A grant's refresh rotations are counted per hour (SEC-1 follow-up).
ALTER TABLE "assistant_grant" ADD COLUMN "rotations" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "assistant_grant" ADD COLUMN "rotation_window_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "assistant_client_unclaimed" ON "assistant_client" ("created_at") WHERE "claimed_at" IS NULL;
--> statement-breakpoint

-- SEC-2: saves kept past the daily Capture allowance are counted per UTC day.
ALTER TABLE "usage_day" ADD COLUMN "kept" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- A Memory's typo-matching words are capped, earliest first, so one long
-- body cannot write tens of thousands of memory_word rows.
CREATE OR REPLACE FUNCTION memory_words_refresh() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  t record := memory_texts(NEW);
BEGIN
  DELETE FROM memory_word WHERE memory_id = NEW.id;
  INSERT INTO memory_word (memory_id, user_id, word)
  SELECT NEW.id, NEW.user_id, w.lexeme
  FROM unnest(to_tsvector('simple', concat_ws(' ', t.a, t.b, t.c))) AS w
  WHERE char_length(w.lexeme) BETWEEN 3 AND 40
  ORDER BY w.positions[1] NULLS LAST, w.lexeme
  LIMIT 4000;
  RETURN NULL;
END $$;
--> statement-breakpoint

-- SEC-3: AI cost held before a call, per owner, so parallel calls cannot overshoot.
CREATE TABLE "ai_reservation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "micros" bigint NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "settled_at" timestamp with time zone,
  CONSTRAINT "ai_reservation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
--> statement-breakpoint
CREATE INDEX "ai_reservation_owner_idx" ON "ai_reservation" ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX "ai_reservation_created_idx" ON "ai_reservation" ("created_at");
