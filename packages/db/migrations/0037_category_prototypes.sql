CREATE TABLE "category_prototype" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text,
  "name" text NOT NULL,
  "space" text NOT NULL,
  "version" integer NOT NULL,
  "embedding" halfvec NOT NULL,
  CONSTRAINT "category_prototype_owner_name_space_version" UNIQUE NULLS NOT DISTINCT("user_id", "name", "space", "version"),
  CONSTRAINT "category_prototype_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
