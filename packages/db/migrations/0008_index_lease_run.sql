ALTER TABLE "ai_call" ADD COLUMN "estimated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "index_lease_run" integer;--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "index_priority" text DEFAULT 'background' NOT NULL;--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "index_fresh_day" date;