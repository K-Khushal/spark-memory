import { sql } from "drizzle-orm";
import type { Database } from "./client";
import { deletionRequested, lockOwner } from "./owner";

export type RecentSearch = { id: string; query: string; searchedAt: string };

/** Explicit searches only. Thirty days, twenty recents, at most 1,000 events per owner. */
export function searchHistory(db: Database, userId: string) {
  return {
    async recentSearches(): Promise<RecentSearch[]> {
      const rows =
        await db.execute(sql`select id, query, searched_at as "searchedAt" from recent_search
        where user_id = ${userId} and searched_at > now() - interval '30 days'
        order by searched_at desc, id limit 20`);
      return rows.rows as RecentSearch[];
    },
    async forgetSearch(id?: string) {
      await db.transaction(async (tx) => {
        await lockOwner(tx, userId);
        await tx.execute(sql`delete from recent_search where user_id = ${userId}
        ${id ? sql`and id = ${id}::uuid` : sql``}`);
      });
    },
    async rememberSearch(
      query: string,
      click?: { memoryId: string; position: number },
      reformulation = false
    ) {
      const q = query.trim().slice(0, 500);
      if (!q && !click) return;
      await db.transaction(async (tx) => {
        await lockOwner(tx, userId);
        if (await deletionRequested(tx, userId)) return;
        if (click) {
          const own = await tx.execute(
            sql`select id from memory where id = ${click.memoryId}::uuid and user_id = ${userId} for key share`
          );
          if (!own.rows.length) return;
        }
        if (q)
          await tx.execute(sql`insert into recent_search(user_id, query) values (${userId}, ${q})
          on conflict(user_id, query) do update set searched_at = now()`);
        await tx.execute(sql`insert into search_event(user_id, query, memory_id, position, reformulation)
          values (${userId}, ${q}, ${click?.memoryId ?? null}::uuid, ${click?.position ?? null}, ${reformulation})`);
        await tx.execute(sql`delete from recent_search where user_id = ${userId} and id not in
          (select id from recent_search where user_id = ${userId} and searched_at > now() - interval '30 days'
          order by searched_at desc, id limit 20)`);
        await tx.execute(sql`delete from search_event where user_id = ${userId} and id not in
          (select id from search_event where user_id = ${userId} and occurred_at > now() - interval '30 days'
          order by occurred_at desc, id limit 1000)`);
      });
    },
    async searchData() {
      const [recent, events] = await Promise.all([
        db.execute(
          sql`select id, query, searched_at as "searchedAt" from recent_search where user_id = ${userId} and searched_at > now() - interval '30 days' order by searched_at, id`
        ),
        db.execute(
          sql`select id, query, memory_id as "memoryId", position, reformulation, occurred_at as "occurredAt" from search_event where user_id = ${userId} and occurred_at > now() - interval '30 days' order by occurred_at, id`
        ),
      ]);
      return { recentSearches: recent.rows, searchEvents: events.rows };
    },
  };
}
