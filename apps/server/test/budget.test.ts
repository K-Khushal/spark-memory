import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { DAILY_BUDGET_MAX_MICROS } from "@spark/core";
import { cronCalls } from "../src/cron-budget";
import { requeueStalled } from "../src/indexing";
import {
  databaseUrl,
  deliver,
  drain,
  env,
  fakeTurnstile,
  queues,
  recordingQueue,
  signedIn,
  postSearch,
} from "./worker";

// The daily AI budget, spent: only this file spends it, and only for its
// own duration (a row under its own provider name, removed afterwards).
fakeTurnstile();

const PROVIDER = "budget-test";
const sentFor = (id: string) =>
  [...queues.fresh.sent, ...queues.background.sent].filter(
    (m) => m.body.memoryId === id
  );

describe.skipIf(!databaseUrl)("past the daily AI budget", () => {
  const sql = new Client({ connectionString: databaseUrl });
  beforeAll(async () => {
    await sql.connect();
    await sql.query(
      `insert into spend_day (day, provider, cost_micros)
       values ((now() at time zone 'utc')::date, $1, $2)
       on conflict (day, provider) do update set cost_micros = excluded.cost_micros`,
      [PROVIDER, DAILY_BUDGET_MAX_MICROS]
    );
  });
  afterAll(async () => {
    await sql.query(`delete from spend_day where provider = $1`, [PROVIDER]);
    await sql.end();
  });

  async function stalledMemory(body: string) {
    const { call } = await signedIn();
    const res = await call("/api/memories", { method: "POST", json: { body } });
    const { id } = (await res.json()) as { id: string };
    await sql.query(
      `update memory set updated_at = now() - interval '2 hours' where id = $1`,
      [id]
    );
    return { call, id };
  }

  it("still re-sends a fresh Capture whose message was lost, but not background work", async () => {
    const fresh = await stalledMemory("Lost fresh Capture");
    const edited = await stalledMemory("Lost edit");
    await sql.query(
      `update memory set index_priority = 'background' where id = $1`,
      [edited.id]
    );
    queues.fresh.sent.length = 0;
    queues.background.sent.length = 0;
    await requeueStalled(env());
    expect(sentFor(fresh.id).map((m) => m.body.priority)).toEqual(["fresh"]);
    expect(sentFor(edited.id)).toEqual([]);
  });

  it("re-sends only as many stalled Memories as its cron share allows", async () => {
    const first = await stalledMemory("Cap one");
    const second = await stalledMemory("Cap two");
    queues.fresh.sent.length = 0;
    queues.background.sent.length = 0;
    await requeueStalled(env(), cronCalls(4));
    const added = queues.fresh.sent.length + queues.background.sent.length;
    expect(added).toBe(1);
    const ours = [first.id, second.id].filter((id) => sentFor(id).length > 0);
    expect(ours.length).toBeLessThanOrEqual(1);
  });

  it("re-sends stalled fresh work that sits behind background rows", async () => {
    const now = new Date("2000-01-02T02:20:00Z");
    await sql.query(
      "insert into spend_day(day, provider, cost_micros) values ($1, $2, $3)",
      ["2000-01-02", PROVIDER, DAILY_BUDGET_MAX_MICROS]
    );
    const fresh = await stalledMemory("Fresh behind background");
    const { rows } = await sql.query<{ user_id: string }>(
      `select user_id from memory where id = $1`,
      [fresh.id]
    );
    const userId = rows[0]!.user_id;
    const background = crypto.randomUUID();
    for (let i = 0; i < 10; i++) {
      await sql.query(
        `insert into memory (id, user_id, kind, body, index_state, index_priority, updated_at)
         values ($1, $2, 'text', 'background', 'indexing', 'background', $3::timestamptz - interval '5 hours')`,
        [i === 0 ? background : crypto.randomUUID(), userId, now]
      );
    }
    await sql.query(
      `update memory set updated_at = $2::timestamptz - interval '4 hours', index_priority = 'fresh' where id = $1`,
      [fresh.id, now]
    );
    queues.fresh.sent.length = 0;
    queues.background.sent.length = 0;
    await requeueStalled(env(), cronCalls(), now);
    expect(sentFor(fresh.id).map((m) => m.body.priority)).toContain("fresh");
    expect(sentFor(background)).toEqual([]);
  });

  it("re-sends a budget pause within the queue delay limit", async () => {
    const { id } = await stalledMemory("Waiting for tomorrow");
    const { rows } = await sql.query<{ index_generation: string }>(
      "select index_generation from memory where id = $1",
      [id]
    );
    const queue = recordingQueue("spark-reindex-local");
    const message = await deliver(
      "spark-reindex-local",
      {
        memoryId: id,
        run: 1,
        generation: rows[0]!.index_generation,
        priority: "background",
      },
      1,
      env({ REINDEX_QUEUE: queue })
    );
    expect(queue.sent).toHaveLength(1);
    expect(queue.sent[0]!.delaySeconds).toBeGreaterThan(0);
    expect(queue.sent[0]!.delaySeconds).toBeLessThanOrEqual(43_200);
    expect(message.ack).toHaveBeenCalled();
  });

  it("acks a paused message it could not re-send, so a pause never dead-letters", async () => {
    const { id } = await stalledMemory("Paused");
    const broken = recordingQueue("spark-reindex-local");
    broken.send = async () => {
      throw new Error("queue down");
    };
    const message = await deliver(
      "spark-reindex-local",
      { memoryId: id, run: 1, priority: "background" },
      1,
      env({ REINDEX_QUEUE: broken })
    );
    expect(message.ack).toHaveBeenCalled();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("still embeds a fresh Capture, but searches by keyword only and re-embeds nothing in the background", async () => {
    const { call } = await signedIn();
    const res = await call("/api/memories", {
      method: "POST",
      json: { body: "Sunset over the dock" },
    });
    const { id } = (await res.json()) as { id: string };
    await drain(id);
    const vectors = await sql.query(
      "select 1 from memory_vector where memory_id = $1",
      [id]
    );
    expect(vectors.rowCount).toBeGreaterThan(0);
    const full = async (q: string) =>
      (
        (await (await postSearch(call, { q, mode: "full" })).json()) as {
          results: { id: string }[];
        }
      ).results.map((r) => r.id);
    expect(await full("sunset")).toEqual([id]);
    // Its vectors would match; the query is not embedded past the budget.
    expect(await full("twilight")).toEqual([]);
    await sql.query("update memory set vectors_space = null where id = $1", [
      id,
    ]);
    queues.background.sent.length = 0;
    await requeueStalled(env());
    expect(sentFor(id)).toEqual([]);
  });

  it("sends Retry first in line once a day, then to the background", async () => {
    const { call, id } = await stalledMemory("Retried twice");
    for (const expected of ["fresh", "background"]) {
      await sql.query(
        `update memory set index_state = 'failed' where id = $1`,
        [id]
      );
      queues.fresh.sent.length = 0;
      queues.background.sent.length = 0;
      await call(`/api/memories/${id}/reindex`, { method: "POST" });
      expect(sentFor(id).map((m) => m.body.priority)).toEqual([expected]);
    }
  });
});
