ALTER TABLE "ai_call" ADD COLUMN "memory_generation" uuid;--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "index_generation" uuid DEFAULT gen_random_uuid() NOT NULL;