import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { INDEXING } from "@spark/core";
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
      [PROVIDER, INDEXING.dailyBudgetMicros * 10]
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
        (await (await call(`/api/search?q=${q}&mode=full`)).json()) as {
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
