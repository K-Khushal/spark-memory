CREATE TABLE "memory_file" (
	"memory_id" uuid NOT NULL,
	"role" text NOT NULL,
	"r2_key" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"thumbhash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stored_at" timestamp with time zone,
	CONSTRAINT "memory_file_memory_id_role_pk" PRIMARY KEY("memory_id","role"),
	CONSTRAINT "memory_file_r2_key_unique" UNIQUE("r2_key")
);
--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "memory_file" ADD CONSTRAINT "memory_file_memory_id_memory_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memory"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_file_unstored_idx" ON "memory_file" USING btree ("created_at") WHERE "memory_file"."stored_at" is null;