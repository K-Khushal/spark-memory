import { sql } from "drizzle-orm";
import { lockOwner } from "./owner";
import type { Database } from "./client";

export type Assistant = {
  id: string;
  name: string;
  createdAt: Date;
  expiresAt: Date;
};
export type AssistantAccess = Assistant & { userId: string };
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
  return {
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
    /** The atomic delete makes authorization codes single use, including parallel exchanges. */
    async exchange(input: {
      digest: string;
      clientId: string;
      redirect: string;
      challenge: string;
      resource: string;
      tokenDigest: string;
      id: string;
    }) {
      return db.transaction(async (tx) => {
        const owner = (
          await tx.execute<{ userId: string }>(
            sql`select user_id as "userId" from assistant_code where digest = ${input.digest}`
          )
        ).rows[0];
        if (!owner) return false;
        await lockOwner(tx, owner.userId);
        const row = (
          await tx.execute<{ userId: string; name: string }>(sql`
          delete from assistant_code c using assistant_client a
          where c.client_id = a.id and c.digest = ${input.digest} and c.client_id = ${input.clientId}
          and c.redirect = ${input.redirect} and c.challenge = ${input.challenge} and c.resource = ${input.resource}
          and c.expires_at > now() and not exists(select 1 from account_deletion d where d.user_id = c.user_id)
          returning c.user_id as "userId", a.name`)
        ).rows[0];
        if (!row) return false;
        await tx.execute(sql`insert into assistant_token(id, user_id, name, digest, expires_at)
          values (${input.id}, ${row.userId}, ${row.name}, ${input.tokenDigest}, now() + interval '1 hour')`);
        return true;
      });
    },
    async issue(userId: string, id: string, name: string, digest: string) {
      const row = await ownedWrite(
        userId,
        async (tx) =>
          (
            await tx.execute<Assistant>(sql`insert into assistant_token(id, user_id, name, digest, expires_at)
        select ${id}, ${userId}, ${name}, ${digest}, now() + interval '90 days'
        where exists(select 1 from "user" where id = ${userId}) and not exists(select 1 from account_deletion where user_id = ${userId})
        returning id, name, created_at as "createdAt", expires_at as "expiresAt"`)
          ).rows[0]
      );
      return row;
    },
    async access(digest: string) {
      return (
        await db.execute<AssistantAccess>(sql`select id, name, user_id as "userId", created_at as "createdAt", expires_at as "expiresAt"
        from assistant_token t where digest = ${digest} and expires_at > now()
        and not exists(select 1 from account_deletion d where d.user_id = t.user_id)`)
      ).rows[0];
    },
    async list(userId: string) {
      return (
        await db.execute<Assistant>(sql`select id, name, created_at as "createdAt", expires_at as "expiresAt"
        from assistant_token where user_id = ${userId} order by created_at, id`)
      ).rows;
    },
    async revoke(userId: string, id: string) {
      return (
        (
          await db.execute(
            sql`delete from assistant_token where user_id = ${userId} and id = ${id} returning id`
          )
        ).rowCount === 1
      );
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
    async record(access: AssistantAccess, tool: string, resultCount: number) {
      await ownedWrite(access.userId, async (tx) => {
        await tx.execute(sql`insert into assistant_activity(user_id, assistant, tool, result_count)
        select ${access.userId}, ${access.name}, ${tool}, ${resultCount}
        where not exists(select 1 from account_deletion where user_id = ${access.userId})
        and exists(select 1 from "user" where id = ${access.userId})`);
      });
    },
    async activity(userId: string) {
      return (
        await db.execute(sql`select assistant, tool, occurred_at as "occurredAt", result_count as "resultCount"
        from assistant_activity where user_id = ${userId} order by occurred_at desc, id desc limit 100`)
      ).rows;
    },
  };
}
