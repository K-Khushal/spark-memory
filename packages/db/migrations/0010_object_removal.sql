CREATE TABLE "object_removal" (
	"key" text PRIMARY KEY NOT NULL,
	"due_at" timestamp with time zone DEFAULT now() NOT NULL
);
