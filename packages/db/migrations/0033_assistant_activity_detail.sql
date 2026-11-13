ALTER TABLE "assistant_activity" ADD COLUMN "assistant_id" text;--> statement-breakpoint
ALTER TABLE "assistant_activity" ADD COLUMN "memory_id" uuid;--> statement-breakpoint
ALTER TABLE "assistant_activity" ADD CONSTRAINT "assistant_activity_memory_id_memory_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memory"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_activity_assistant" ON "assistant_activity" USING btree ("user_id","assistant_id","id");--> statement-breakpoint
CREATE INDEX "assistant_activity_memory" ON "assistant_activity" USING btree ("memory_id");--> statement-breakpoint
UPDATE "assistant_activity" SET "assistant_id" = 'client:' || "client_id" WHERE "client_id" IS NOT NULL;
--> statement-breakpoint
UPDATE "assistant_activity" a SET "assistant_id" = t."id" FROM "assistant_token" t WHERE a."client_id" IS NULL AND t."client_id" IS NULL AND t."user_id" = a."user_id" AND t."name" = a."assistant" AND (SELECT count(*) FROM "assistant_token" u WHERE u."client_id" IS NULL AND u."user_id" = a."user_id" AND u."name" = a."assistant") = 1;
