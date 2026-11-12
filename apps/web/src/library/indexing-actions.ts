import type { Dispatch, SetStateAction } from "react";
import type { toast } from "@spark/ui";
import type { Memory, WallMemory } from "./library-actions";

/** What Indexing on the wall needs from the server. Each call rejects when it fails. */
export type IndexingTransport = {
  /** The owner's Memories among `ids` (at most 100). */
  poll: (ids: string[]) => Promise<Memory[]>;
  retryIndexing: (id: string) => Promise<Memory>;
  setAiOptOut: (id: string, on: boolean) => Promise<Memory>;
  /** Try Again on a Deep fetch that Failed or was Unavailable. */
  retryDeepFetch: (id: string) => Promise<Memory>;
};

/**
 * The fields Indexing changes; everything else on the wall stays as the
 * wall has it. For a link or a PDF that includes the text Indexing kept
 * (never edited, so it cannot clash with an edit in progress).
 */
const indexFields = (m: Memory) => ({
  indexState: m.indexState,
  indexError: m.indexError,
  indexTitle: m.indexTitle,
  aiOptOut: m.aiOptOut,
  deepFetch: m.deepFetch,
  hasVectors: m.hasVectors,
  preservation: m.preservation,
  pageTitle: m.pageTitle,
  description: m.description,
  video: m.video,
  ...((m.kind === "link" || m.kind === "pdf" || m.kind === "video") && {
    body: m.body,
  }),
});

/** Poll every 2 s, then back off by half each time nothing changed, up to 30 s. */
export const POLL = { first: 2000, factor: 1.5, max: 30_000, batch: 100 };
export const nextPollDelay = (delay: number) =>
  Math.min(POLL.max, Math.round(delay * POLL.factor));

/**
 * Memories the wall shows Indexing, or Deep fetching about now (a wait of an
 * hour or more is not polled), once their upload (if any) is done.
 */
export const indexingIds = (memories: WallMemory[]) =>
  memories
    .filter(
      (m) =>
        (m.indexState === "indexing" || m.deepFetch === "fetching") && !m.upload
    )
    .map((m) => m.id)
    .slice(0, POLL.batch);

/**
 * Index state on the wall: live updates while Indexing, Retry on Failed and
 * the AI opt-out switch, each optimistic and rolled back with a message if
 * the server says no.
 */
export function indexingActions({
  setMemories,
  transport,
  notify,
  isPending,
  onChanged = () => {},
}: {
  setMemories: Dispatch<SetStateAction<WallMemory[]>>;
  transport: IndexingTransport;
  notify: typeof toast;
  /** A request for this Memory (its Capture, Try Again) has not finished. */
  isPending: (id: string) => boolean;
  /**
   * What search finds has changed: Indexing finished (or failed) for a
   * Memory, or the server took an AI opt-out switch. Open searches run again.
   */
  onChanged?: () => void;
}) {
  const merge = (fresh: Memory[]) => {
    const byId = new Map(fresh.map((m) => [m.id, m]));
    setMemories((all) =>
      all.map((m) => {
        const now = byId.get(m.id);
        return now ? { ...m, ...indexFields(now) } : m;
      })
    );
  };
  const patch = (id: string, fields: Partial<Memory>) =>
    setMemories((all) =>
      all.map((m) => (m.id === id ? { ...m, ...fields } : m))
    );

  /**
   * Polls in a row each Memory has been missing from. A poll can overtake
   * a slow Capture, so a miss counts only once nothing is pending for it,
   * and only GONE_AFTER misses in a row (deleted elsewhere) stop the asking.
   */
  const misses = new Map<string, number>();
  const GONE_AFTER = 2;
  /**
   * AI opt-out switches in flight, one request per Memory at a time:
   * `want` is the latest switch not yet sent, `before` the wall's state
   * before the first one, to roll back to.
   */
  const switching = new Map<
    string,
    { want?: boolean; before: ReturnType<typeof indexFields> }
  >();

  async function sendAiOptOut(id: string) {
    const entry = switching.get(id)!;
    while (entry.want !== undefined) {
      const on = entry.want;
      entry.want = undefined;
      try {
        const now = await transport.setAiOptOut(id, on);
        // A later switch is waiting: its answer is the one to show.
        if (entry.want === undefined) {
          merge([now]);
          onChanged();
        }
      } catch {
        if (entry.want === undefined) {
          patch(id, entry.before);
          notify("AI Opt-Out Did Not Change");
        }
      }
    }
    switching.delete(id);
  }

  return {
    /** Asks after `ids` and puts their Index state on the wall. */
    async poll(ids: string[]) {
      const fresh = await transport.poll(ids);
      const found = new Set(fresh.map((m) => m.id));
      for (const id of ids) {
        if (found.has(id) || isPending(id)) misses.delete(id);
        else misses.set(id, (misses.get(id) ?? 0) + 1);
      }
      merge(fresh);
      // Only Memories still Indexing are polled: any other state is news.
      if (fresh.some((m) => m.indexState !== "indexing")) onChanged();
    },

    /**
     * The ids worth asking after: Indexing on the wall, and still on the
     * server (or sent again). Pure, so the wall can ask while it renders.
     */
    pollable: (memories: WallMemory[]) =>
      indexingIds(
        memories.filter(
          (m) => isPending(m.id) || (misses.get(m.id) ?? 0) < GONE_AFTER
        )
      ),

    /** Memories sent again (Try Again) start their misses over: call after a render, not in it. */
    restartMisses(memories: WallMemory[]) {
      for (const m of memories) if (isPending(m.id)) misses.delete(m.id);
    },

    async retryIndexing(memory: Memory) {
      patch(memory.id, { indexState: "indexing", indexError: null });
      try {
        merge([await transport.retryIndexing(memory.id)]);
      } catch {
        patch(memory.id, indexFields(memory));
        notify("Retry Did Not Finish");
      }
    },

    /** Try Again on a Deep fetch: Fetching at once, rolled back with a message if refused. */
    async retryDeepFetch(memory: Memory) {
      patch(memory.id, { deepFetch: "fetching" });
      try {
        merge([await transport.retryDeepFetch(memory.id)]);
      } catch {
        patch(memory.id, { deepFetch: memory.deepFetch });
        notify("Try Again Did Not Finish");
      }
    },

    /** Optimistic; switches sent in order, one at a time, the latest winning. */
    async setAiOptOut(memory: Memory, on: boolean) {
      patch(memory.id, {
        aiOptOut: on,
        ...(on
          ? { indexState: "searchable", indexError: null, indexTitle: null }
          : { indexState: "indexing" }),
      });
      const entry = switching.get(memory.id);
      if (entry) {
        entry.want = on;
        return;
      }
      switching.set(memory.id, { want: on, before: indexFields(memory) });
      await sendAiOptOut(memory.id);
    },
  };
}
