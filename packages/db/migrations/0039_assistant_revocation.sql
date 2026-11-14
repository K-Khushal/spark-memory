-- A revocation's grace period starts when access ends, not at the last call.
CREATE TABLE assistant_revocation (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  assistant_id text NOT NULL,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, assistant_id)
);
--> statement-breakpoint
CREATE FUNCTION remember_assistant_revocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "user" WHERE id = OLD.user_id) THEN
    IF TG_TABLE_NAME = 'assistant_grant' THEN
      INSERT INTO assistant_revocation(user_id, assistant_id)
      VALUES (OLD.user_id, 'client:' || OLD.client_id)
      ON CONFLICT (user_id, assistant_id) DO UPDATE SET revoked_at = now();
    ELSIF OLD.client_id IS NULL THEN
      INSERT INTO assistant_revocation(user_id, assistant_id)
      VALUES (OLD.user_id, OLD.id)
      ON CONFLICT (user_id, assistant_id) DO UPDATE SET revoked_at = now();
    END IF;
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER assistant_grant_revocation AFTER DELETE ON assistant_grant
FOR EACH ROW EXECUTE FUNCTION remember_assistant_revocation();
--> statement-breakpoint
CREATE TRIGGER assistant_token_revocation AFTER DELETE ON assistant_token
FOR EACH ROW EXECUTE FUNCTION remember_assistant_revocation();
