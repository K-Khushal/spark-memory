CREATE TABLE "ai_call" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"memory_id" uuid NOT NULL,
	"day" date NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_micros" bigint NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_index" (
	"memory_id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"ocr_text" text NOT NULL,
	"entities" text[] NOT NULL,
	"tags" text[] NOT NULL,
	"model" text NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spend_day" (
	"day" date NOT NULL,
	"provider" text NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "spend_day_day_provider_pk" PRIMARY KEY("day","provider")
);
--> statement-breakpoint
ALTER TABLE "memory" ALTER COLUMN "search_tsv" DROP EXPRESSION;--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "index_run" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "index_error" text;--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "ai_opt_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "memory_file" ADD COLUMN "palette" text[];--> statement-breakpoint
ALTER TABLE "memory_index" ADD CONSTRAINT "memory_index_memory_id_memory_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memory"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_call_memory_idx" ON "ai_call" USING btree ("memory_id");--> statement-breakpoint
CREATE INDEX "ai_call_user_day_idx" ON "ai_call" USING btree ("user_id","day");