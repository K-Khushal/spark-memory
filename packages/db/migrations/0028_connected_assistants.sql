CREATE TABLE "assistant_activity" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "assistant_activity_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"assistant" text NOT NULL,
	"tool" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result_count" integer NOT NULL
);
--> statement-breakpoint

CREATE TABLE "assistant_client" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"redirects" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "assistant_code" (
	"digest" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"client_id" text NOT NULL,
	"redirect" text NOT NULL,
	"challenge" text NOT NULL,
	"resource" text NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '5 minutes' NOT NULL
);
--> statement-breakpoint

CREATE TABLE "assistant_token" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"window_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_token_digest_unique" UNIQUE("digest")
);
--> statement-breakpoint

ALTER TABLE "assistant_activity" ADD CONSTRAINT "assistant_activity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "assistant_code" ADD CONSTRAINT "assistant_code_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "assistant_code" ADD CONSTRAINT "assistant_code_client_id_assistant_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."assistant_client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "assistant_token" ADD CONSTRAINT "assistant_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "assistant_activity_owner" ON "assistant_activity" USING btree ("user_id","occurred_at");--> statement-breakpoint

CREATE INDEX "assistant_token_owner" ON "assistant_token" USING btree ("user_id");
--> statement-breakpoint
CREATE FUNCTION revoke_assistants_on_deletion() RETURNS trigger AS $$
BEGIN
  DELETE FROM assistant_token WHERE user_id = NEW.user_id;
  DELETE FROM assistant_code WHERE user_id = NEW.user_id;
  DELETE FROM assistant_activity WHERE user_id = NEW.user_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER revoke_assistants_on_deletion AFTER INSERT ON account_deletion
FOR EACH ROW EXECUTE FUNCTION revoke_assistants_on_deletion();
