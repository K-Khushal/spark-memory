CREATE TABLE "memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text,
	"body" text,
	"capture_note" text,
	"preservation" text DEFAULT 'preserved' NOT NULL,
	"index_state" text DEFAULT 'indexing' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search_tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english'::regconfig, coalesce("memory"."title", '')), 'A') || setweight(to_tsvector('english'::regconfig, coalesce("memory"."capture_note", '')), 'B') || setweight(to_tsvector('english'::regconfig, coalesce("memory"."body", '')), 'C')) STORED
);
--> statement-breakpoint
CREATE TABLE "memory_word" (
	"memory_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"word" text NOT NULL,
	CONSTRAINT "memory_word_memory_id_word_pk" PRIMARY KEY("memory_id","word")
);
--> statement-breakpoint
ALTER TABLE "memory" ADD CONSTRAINT "memory_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_word" ADD CONSTRAINT "memory_word_memory_id_memory_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memory"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_user_captured_idx" ON "memory" USING btree ("user_id","captured_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "memory_search_tsv_idx" ON "memory" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "memory_word_user_idx" ON "memory_word" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "memory_word_trgm_idx" ON "memory_word" USING gin ("word" gin_trgm_ops);