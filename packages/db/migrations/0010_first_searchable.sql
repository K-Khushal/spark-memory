ALTER TABLE "memory" ADD COLUMN "first_searchable_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "product_analytics" boolean DEFAULT false NOT NULL;