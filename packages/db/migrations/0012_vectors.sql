CREATE TABLE "memory_vector" (
	"memory_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"anchor" jsonb,
	"model" text NOT NULL,
	"dimensions" integer NOT NULL,
	"embedding" halfvec NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_call" ALTER COLUMN "memory_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "vectors_space" text;--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "vectors_revision" integer;--> statement-breakpoint
ALTER TABLE "memory_vector" ADD CONSTRAINT "memory_vector_memory_id_memory_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memory"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_vector_user_idx" ON "memory_vector" USING btree ("user_id","model");--> statement-breakpoint
CREATE INDEX "memory_vector_memory_idx" ON "memory_vector" USING btree ("memory_id");