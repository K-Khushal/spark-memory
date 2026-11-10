// `pnpm --filter @spark/db db:seed`: fills the local database with a demo
// Library. Sign in as demo@example.com (the code is in the dev outbox).
// Re-running replaces the demo Library; nobody else's Memories are touched.
import { eq } from "drizzle-orm";
import { loadRootEnv } from "@spark/config/load-env";
import { checkDatabase, openDatabase, openLibrary, schema } from "../index";
import { DEMO_EMAIL, DEMO_LIBRARY } from "./demo-library";

loadRootEnv();

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error("DATABASE_URL is not set (copy .env.example to .env)");

// Demo data never goes near the dev or prod databases.
if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
  throw new Error("db:seed only runs against a local database");
}

const health = await checkDatabase(url);
if (!health.ok) throw new Error(`Database unreachable (${health.reason})`);

const { db, close } = openDatabase(url);
try {
  const [user] = await db
    .insert(schema.user)
    .values({
      id: crypto.randomUUID(),
      name: "Demo",
      email: DEMO_EMAIL,
      emailVerified: true,
    })
    .onConflictDoUpdate({ target: schema.user.email, set: { name: "Demo" } })
    .returning({ id: schema.user.id });
  await db.delete(schema.memory).where(eq(schema.memory.userId, user!.id));

  // Oldest first, so the first entry ends up at the top of the wall.
  const library = openLibrary(db, user!.id);
  for (const memory of [...DEMO_LIBRARY].reverse()) {
    await library.capture(memory);
  }
  console.log(
    `db:seed: ${DEMO_LIBRARY.length} demo Memories for ${DEMO_EMAIL}.`
  );
} finally {
  await close();
}
