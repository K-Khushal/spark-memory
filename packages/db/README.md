# @spark/db

Drizzle schema, migrations, seed data and the hybrid search SQL function (ADR-0003, ADR-0004).

Entry point: `index.ts`. Implementation goes in `lib/`, tests in `tests/` (see [packages/README.md](../README.md)).

## Migrations

`migrations/meta/_journal.json` lists every migration. Drizzle's migrator applies a migration only if its journal `when` is later than the newest one already applied, so an entry with an earlier `when` is silently skipped in production. `tests/migration-journal.test.ts` (part of `pnpm check`, no database needed) fails when the journal is out of order. Its messages say what to rename and which `when` to raise. It asserts that:

- `idx` and `when` strictly increase;
- each `tag` has a `.sql` file whose numeric prefix is `idx` zero-padded to 4 digits;
- no two `.sql` files share a prefix;
- every `.sql` file has a journal entry.

### When parallel PRs collide

Two PRs that each ran `drizzle-kit generate` get the same next number, and the second one to merge must renumber. After merging `main` into your branch:

1. Rename your SQL file to the next free number (`git mv migrations/0033_a.sql migrations/0034_a.sql`).
2. In `_journal.json`, set your entry's `idx` and `tag` to match, and move it to the end of `entries`.
3. Raise its `when` above the last entry's (any larger number works; `Date.now()` is fine).
4. Rename its `meta/00NN_snapshot.json` the same way and keep `prevId` chained to the previous snapshot's `id`.
5. Run `pnpm --filter @spark/db test`.

Never lower or edit the `when` of a migration that has already merged. Production has applied it.
