ALTER TABLE "assistant_activity" ADD COLUMN "assistant_id" text;--> statement-breakpoint
ALTER TABLE "assistant_activity" ADD COLUMN "memory_id" uuid;--> statement-breakpoint
ALTER TABLE "assistant_activity" ADD CONSTRAINT "assistant_activity_memory_id_memory_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memory"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_activity_assistant" ON "assistant_activity" USING btree ("user_id","assistant_id","id");--> statement-breakpoint
CREATE INDEX "assistant_activity_memory" ON "assistant_activity" USING btree ("memory_id");--> statement-breakpoint
UPDATE "assistant_activity" SET "assistant_id" = 'client:' || "client_id" WHERE "client_id" IS NOT NULL;
