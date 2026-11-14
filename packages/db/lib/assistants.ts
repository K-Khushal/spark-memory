import { sql, type SQL } from "drizzle-orm";
import { lockOwner } from "./owner";
import type { Database } from "./client";

export type Assistant = {
  id: string;
  name: string;
  clientId: string | null;
  createdAt: Date;
  expiresAt: Date;
};
export type AssistantAccess = Assistant & { userId: string };
/** A Settings row: a personal token, or one OAuth client (`client:<id>`). */
export type AssistantRow = Assistant & { lastActiveAt: string | null };
/** One tool call. `memory` is the opened Memory, gone once it is deleted. */
export type AssistantActivity = {
  id: string;
  clientId: string | null;
  assistant: string;
  tool: string;
  occurredAt: string;
  resultCount: number;
  memory: { id: string; title: string | null } | null;
};
const iso = (column: string) =>
  `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
/** The one Settings identity shared by all grants for an OAuth client. */
const clientRowId = (id: string | SQL) => sql`'client:' || ${id}`;
export type OAuthClient = { id: string; name: string; redirects: string[] };

/** Only digests cross the persistence boundary. No query or Memory content is accepted here. */
export function assistantStore(db: Database) {
  const ownedWrite = <T>(
    userId: string,
    work: (tx: Pick<Database, "execute">) => Promise<T>
  ) =>
    db.transaction(async (tx) => {
      await lockOwner(tx, userId);
      return work(tx);
    });
  const mint = async (
    tx: Pick<Database, "execute">,
    input: {
      id: string;
      userId: string;
      clientId: string;
      grantId: string;
      tokenDigest: string;
      refreshDigest: string;
    }
  ) => {
    await tx.execute(
      sql`delete from assistant_token where grant_id = ${input.grantId} and expires_at <= now()`
    );
    await tx.execute(sql`insert into assistant_token(id, user_id, client_id, grant_id, name, digest, expires_at)
      select ${input.id}, ${input.userId}, ${input.clientId}, ${input.grantId}, name, ${input.tokenDigest}, now() + interval '1 hour' from assistant_client where id = ${input.clientId}`);
    await tx.execute(
      sql`insert into assistant_refresh(digest, grant_id) values (${input.refreshDigest}, ${input.grantId})`
    );
  };
  return {
    /** Hourly retention: keep a short replay-detection grace, never current credentials. */
    async sweep(batch = 500) {
      // One owner-agnostic statement and a bounded batch per hourly invocation.
      // OAuth refresh rotates tokens, so liveness comes from grants, not tokens.
      await db.execute(sql`delete from assistant_activity where id in (
        select a.id from assistant_activity a
        where a.occurred_at <= now() - interval '90 days'
          or (greatest((select r.revoked_at from assistant_revocation r
              where r.user_id = a.user_id and r.assistant_id = a.assistant_id),
              (select max(t.expires_at) from assistant_token t where t.user_id = a.user_id and t.id = a.assistant_id),
              (select max(g.expires_at) from assistant_grant g where g.user_id = a.user_id and ${clientRowId(sql`g.client_id`)} = a.assistant_id),
              a.occurred_at) <= now() - interval '30 days'
            and not exists(select 1 from assistant_token t where t.user_id = a.user_id
              and t.id = a.assistant_id and t.client_id is null and t.expires_at > now())
            and not exists(select 1 from assistant_grant g where g.user_id = a.user_id
              and ${clientRowId(sql`g.client_id`)} = a.assistant_id and g.expires_at > now()))
        order by a.occurred_at, a.id limit ${batch}
        for update of a skip locked
      )`);
      await db.execute(
        sql`delete from assistant_refresh where used and (used_at is null or used_at <= now() - interval '1 minute')`
      );
      await db.execute(
        sql`delete from assistant_code_use where expires_at <= now()`
      );
    },
    async allowRegistration(key: string) {
      return (
        (
          await db.execute(sql`insert into rate_limit (id, key, count, last_request) values (${crypto.randomUUID()}, ${key}, 1, floor(extract(epoch from now()) * 1000))
        on conflict (key) do update set count = case when rate_limit.last_request < floor(extract(epoch from now()) * 1000) - 60000 then 1 else rate_limit.count + 1 end,
        last_request = case when rate_limit.last_request < floor(extract(epoch from now()) * 1000) - 60000 then floor(extract(epoch from now()) * 1000) else rate_limit.last_request end
        where rate_limit.count < 10 or rate_limit.last_request < floor(extract(epoch from now()) * 1000) - 60000 returning id`)
        ).rowCount === 1
      );
    },
    async register(client: OAuthClient) {
      await db.execute(
        sql`insert into assistant_client(id, name, redirects) values (${client.id}, ${client.name}, ${JSON.stringify(client.redirects)}::jsonb)`
      );
    },
    async client(id: string) {
      return (
        await db.execute<OAuthClient>(
          sql`select id, name, redirects from assistant_client where id = ${id}`
        )
      ).rows[0];
    },
    async grant(input: {
      digest: string;
      userId: string;
      clientId: string;
      redirect: string;
      challenge: string;
      resource: string;
    }) {
      await ownedWrite(input.userId, async (tx) => {
        await tx.execute(sql`insert into assistant_code(digest, user_id, client_id, redirect, challenge, resource)
        select ${input.digest}, ${input.userId}, ${input.clientId}, ${input.redirect}, ${input.challenge}, ${input.resource}
        where exists(select 1 from "user" where id = ${input.userId}) and not exists(select 1 from account_deletion where user_id = ${input.userId})`);
      });
    },
    /** Burn on the first attempt, even on a mismatch; receipts revoke credentials on replay. */
    async exchange(input: {
      digest: string;
      clientId: string;
      redirect: string;
      challenge: string;
      resource: string;
      tokenDigest: string;
      refreshDigest: string;
      id: string;
    }) {
      return db.transaction(async (tx) => {
        const owner = (
          await tx.execute<{ userId: string }>(sql`
          select user_id as "userId" from assistant_code where digest = ${input.digest}
          union all select user_id from assistant_code_use where digest = ${input.digest} and expires_at > now() limit 1`)
        ).rows[0];
        if (!owner) return false;
        await lockOwner(tx, owner.userId);
        const row = (
          await tx.execute<{
            userId: string;
            clientId: string;
            redirect: string;
            challenge: string;
            resource: string;
            valid: boolean;
          }>(sql`
          delete from assistant_code where digest = ${input.digest}
          returning user_id as "userId", client_id as "clientId", redirect, challenge, resource,
          expires_at > now() and not exists(select 1 from account_deletion where user_id = assistant_code.user_id) as valid`)
        ).rows[0];
        if (!row) {
          await tx.execute(
            sql`delete from assistant_grant where id in (select grant_id from assistant_code_use where digest = ${input.digest} and expires_at > now())`
          );
          await tx.execute(
            sql`delete from assistant_token where id in (select grant_id from assistant_code_use where digest = ${input.digest} and expires_at > now())`
          );
          return false;
        }
        await tx.execute(
          sql`insert into assistant_code_use(digest, user_id, grant_id) values (${input.digest}, ${row.userId}, ${input.id})`
        );
        if (
          !row.valid ||
          row.clientId !== input.clientId ||
          row.redirect !== input.redirect ||
          row.challenge !== input.challenge ||
          row.resource !== input.resource
        )
          return false;
        await tx.execute(
          sql`delete from assistant_grant where user_id = ${row.userId} and (expires_at <= now() or client_id = ${row.clientId})`
        );
        const count = (
          await tx.execute<{ count: number }>(
            sql`select count(distinct client_id)::int as count from assistant_grant where user_id = ${row.userId} and expires_at > now()`
          )
        ).rows[0]!.count;
        if (count >= 20) return "limit" as const;
        await tx.execute(
          sql`insert into assistant_grant(id, user_id, client_id, resource) values (${input.id}, ${row.userId}, ${row.clientId}, ${row.resource})`
        );
        await mint(tx, { ...input, userId: row.userId, grantId: input.id });
        return true;
      });
    },
    async refresh(input: {
      digest: string;
      clientId: string;
      resource: string;
      tokenDigest: string;
      refreshDigest: string;
      id: string;
    }) {
      const owner = (
        await db.execute<{ userId: string }>(
          sql`select g.user_id as "userId" from assistant_refresh r join assistant_grant g on g.id = r.grant_id where r.digest = ${input.digest}`
        )
      ).rows[0];
      if (!owner) return false;
      return ownedWrite(owner.userId, async (tx) => {
        const row = (
          await tx.execute<{
            grantId: string;
            clientId: string;
            resource: string;
            used: boolean;
            valid: boolean;
          }>(sql`
          select g.id as "grantId", g.client_id as "clientId", g.resource, r.used,
          g.expires_at > now() and not exists(select 1 from account_deletion where user_id = g.user_id) as valid
          from assistant_refresh r join assistant_grant g on g.id = r.grant_id where r.digest = ${input.digest}`)
        ).rows[0];
        if (
          !row ||
          row.clientId !== input.clientId ||
          row.resource !== input.resource
        )
          return false;
        if (!row.valid || row.used) {
          await tx.execute(
            sql`delete from assistant_grant where id = ${row.grantId}`
          );
          return false;
        }
        await tx.execute(
          sql`update assistant_refresh set used = true, used_at = now() where digest = ${input.digest}`
        );
        await tx.execute(
          sql`update assistant_grant set expires_at = now() + interval '90 days' where id = ${row.grantId}`
        );
        await mint(tx, {
          ...input,
          userId: owner.userId,
          grantId: row.grantId,
        });
        return true;
      });
    },
    async issue(userId: string, id: string, name: string, digest: string) {
      const row = await ownedWrite(userId, async (tx) => {
        await tx.execute(
          sql`delete from assistant_token where user_id = ${userId} and expires_at <= now()`
        );
        const count = (
          await tx.execute<{ count: number }>(
            sql`select count(*)::int as count from assistant_token where user_id = ${userId} and client_id is null and expires_at > now()`
          )
        ).rows[0]!.count;
        if (count >= 10) return "limit" as const;
        return (
          await tx.execute<Assistant>(sql`insert into assistant_token(id, user_id, name, digest, expires_at)
          select ${id}, ${userId}, ${name}, ${digest}, now() + interval '90 days'
          where exists(select 1 from "user" where id = ${userId}) and not exists(select 1 from account_deletion where user_id = ${userId})
          returning id, name, client_id as "clientId", created_at as "createdAt", expires_at as "expiresAt"`)
        ).rows[0];
      });
      return row;
    },
    async access(digest: string) {
      return (
        await db.execute<AssistantAccess>(sql`select id, name, client_id as "clientId", user_id as "userId", created_at as "createdAt", expires_at as "expiresAt"
        from assistant_token t where digest = ${digest} and expires_at > now()
        and (grant_id is null or exists(select 1 from assistant_grant g where g.id = t.grant_id and g.expires_at > now()))
        and not exists(select 1 from account_deletion d where d.user_id = t.user_id)`)
      ).rows[0];
    },
    async list(userId: string) {
      return (
        await db.execute<AssistantRow>(sql`
        select t.id, t.name, t.client_id as "clientId", t.created_at as "createdAt", t.expires_at as "expiresAt",
          (select ${sql.raw(iso("a.occurred_at"))} from assistant_activity a where a.user_id = t.user_id and a.assistant_id = t.id order by a.id desc limit 1) as "lastActiveAt"
        from assistant_token t where t.user_id = ${userId} and t.client_id is null and t.expires_at > now()
        union all
        select ${clientRowId(sql`g.client_id`)}, c.name, g.client_id, min(g.created_at), max(g.expires_at),
          (select ${sql.raw(iso("a.occurred_at"))} from assistant_activity a where a.user_id = g.user_id and a.assistant_id = ${clientRowId(sql`g.client_id`)} order by a.id desc limit 1)
          from assistant_grant g join assistant_client c on c.id = g.client_id
          where g.user_id = ${userId} and g.expires_at > now() group by g.user_id, g.client_id, c.name
        order by "createdAt", id`)
      ).rows;
    },
    async revoke(userId: string, id: string) {
      return ownedWrite(userId, async (tx) => {
        const row = (
          await tx.execute<{
            clientId: string | null;
          }>(sql`select client_id as "clientId" from assistant_grant where id = ${id} and user_id = ${userId}
          union all select client_id from assistant_token where id = ${id} and user_id = ${userId}
          union all select client_id from assistant_grant where client_id = ${id.startsWith("client:") ? id.slice(7) : ""} and user_id = ${userId} limit 1`)
        ).rows[0];
        if (!row) return false;
        if (row.clientId) {
          await tx.execute(
            sql`delete from assistant_grant where user_id = ${userId} and client_id = ${row.clientId}`
          );
          await tx.execute(
            sql`delete from assistant_token where user_id = ${userId} and client_id = ${row.clientId}`
          );
          await tx.execute(
            sql`delete from assistant_code where user_id = ${userId} and client_id = ${row.clientId}`
          );
        } else
          await tx.execute(
            sql`delete from assistant_token where user_id = ${userId} and id = ${id}`
          );
        return true;
      });
    },
    /** Shared-database fixed window; #27 can replace this seam with its limiter. */
    async allow(id: string) {
      return (
        (
          await db.execute(sql`update assistant_token set calls = case when window_at <= now() - interval '1 minute' then 1 else calls + 1 end,
        window_at = case when window_at <= now() - interval '1 minute' then now() else window_at end
        where id = ${id} and (calls < 60 or window_at <= now() - interval '1 minute') returning id`)
        ).rowCount === 1
      );
    },
    /** `memoryId` is the Memory `get_memory` opened. Never a query or content. */
    async record(
      access: AssistantAccess,
      tool: string,
      resultCount: number,
      memoryId: string | null = null
    ) {
      const rowId = access.clientId ? clientRowId(access.clientId) : access.id;
      await ownedWrite(access.userId, async (tx) => {
        await tx.execute(sql`insert into assistant_activity(user_id, client_id, assistant_id, assistant, tool, result_count, memory_id)
        select ${access.userId}, ${access.clientId}, ${rowId}, ${access.name}, ${tool}, ${resultCount},
          (select id from memory where id = ${memoryId} and user_id = ${access.userId})
        where not exists(select 1 from account_deletion where user_id = ${access.userId})
        and exists(select 1 from "user" where id = ${access.userId})`);
      });
    },
    /**
     * The owner's log, newest first, optionally of one Settings row. `before` is
     * the previous page's `next`. Titles are read from the owner's Library now.
     */
    async activity(
      userId: string,
      page: { assistantId?: string; before?: string; limit?: number } = {}
    ) {
      const limit = page.limit ?? 20;
      const rows = (
        await db.execute<AssistantActivity>(sql`
        select a.id::text as id, a.client_id as "clientId", a.assistant, a.tool,
          ${sql.raw(iso("a.occurred_at"))} as "occurredAt", a.result_count as "resultCount",
          case when m.id is null then null else jsonb_build_object('id', m.id, 'title', m.title) end as memory
        from assistant_activity a left join memory m on m.id = a.memory_id and m.user_id = a.user_id
        where a.user_id = ${userId}
          and (${page.assistantId ?? null}::text is null or a.assistant_id = ${page.assistantId ?? null})
          and (${page.before ?? null}::bigint is null or a.id < ${page.before ?? null}::bigint)
        order by a.id desc limit ${limit + 1}`)
      ).rows;
      const activity = rows.slice(0, limit);
      return {
        activity,
        next: rows.length > limit ? activity[limit - 1]!.id : null,
      };
    },
  };
}
