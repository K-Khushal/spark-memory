import { eq } from "drizzle-orm";
import { schema, type Database } from "../index";

/** A throwaway person to own a Library in tests. */
export async function newUser(db: Database): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .insert(schema.user)
    .values({ id, name: "", email: `library-${id}@example.com` });
  return id;
}

export async function removeUser(db: Database, id: string) {
  await db.delete(schema.user).where(eq(schema.user.id, id));
}
