CREATE TABLE "assistant_code_use" (
	"digest" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"grant_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"client_id" text NOT NULL,
	"resource" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '90 days' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_refresh" (
	"digest" text PRIMARY KEY NOT NULL,
	"grant_id" text NOT NULL,
	"used" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_activity" ADD COLUMN "client_id" text;--> statement-breakpoint
ALTER TABLE "assistant_token" ADD COLUMN "client_id" text;--> statement-breakpoint
ALTER TABLE "assistant_token" ADD COLUMN "grant_id" text;--> statement-breakpoint
ALTER TABLE "assistant_code_use" ADD CONSTRAINT "assistant_code_use_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_grant" ADD CONSTRAINT "assistant_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_grant" ADD CONSTRAINT "assistant_grant_client_id_assistant_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."assistant_client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_refresh" ADD CONSTRAINT "assistant_refresh_grant_id_assistant_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."assistant_grant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_grant_owner_client" ON "assistant_grant" USING btree ("user_id","client_id");--> statement-breakpoint
ALTER TABLE "assistant_activity" ADD CONSTRAINT "assistant_activity_client_id_assistant_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."assistant_client"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_token" ADD CONSTRAINT "assistant_token_client_id_assistant_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."assistant_client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_token" ADD CONSTRAINT "assistant_token_grant_id_assistant_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."assistant_grant"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION revoke_assistants_on_deletion() RETURNS trigger AS $$
BEGIN
 DELETE FROM assistant_grant WHERE user_id = NEW.user_id;
 DELETE FROM assistant_token WHERE user_id = NEW.user_id;
 DELETE FROM assistant_code WHERE user_id = NEW.user_id;
 DELETE FROM assistant_code_use WHERE user_id = NEW.user_id;
 DELETE FROM assistant_activity WHERE user_id = NEW.user_id;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
