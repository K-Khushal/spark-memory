import type { HeldShare, PendingShare } from "./hold";
import { REFUSAL_COPY } from "./refusal";
import { applyShare, planShare, type ShareLibrary } from "./share";

/** The hold, as the drain needs it (hold.ts holds the IndexedDB one). */
export type Hold = {
  held: () => Promise<{ shares: HeldShare[]; unreadable: number }>;
  get: (key: IDBValidKey) => Promise<PendingShare | undefined>;
  drop: (keys: IDBValidKey[]) => Promise<void>;
};

/** Web Locks (`navigator.locks`): one holder per name, the rest wait. */
export type Locks = {
  request: <T>(name: string, run: () => Promise<T>) => Promise<T>;
};

type Deps = {
  hold: Hold;
  locks?: Locks;
  library: ShareLibrary;
  notify: (message: string) => void;
};

const claim = <T>(
  locks: Locks | undefined,
  key: IDBValidKey,
  run: () => Promise<T>
) => (locks ? locks.request(`spark-share-${String(key)}`, run) : run());

/**
 * Captures one held share under its lock and drops it only when the server
 * has it, or, with `capture: false`, drops it unseen. A share Capture turned
 * away for want of room stays held. The lock queues tabs; the check that the
 * share is still held means a tab that waited finds it already done. A tab
 * that closes mid-Capture frees the lock and leaves the share held, so the
 * next tab sends it again under the same Capture id and the server's
 * idempotent create makes no second Memory. Without Web Locks two claims can
 * both run; the stable id covers that too.
 *
 * Rejects when the hold cannot be read or written; the share is still held.
 */
export function decideShare({
  hold,
  locks,
  library,
  key,
  capture,
  live = () => true,
}: Deps & {
  key: IDBValidKey;
  capture: boolean;
  /** False once the page that asked has gone: no new Capture starts. */
  live?: () => boolean;
}): Promise<void> {
  return claim(locks, key, async () => {
    if (!live()) return;
    const share = await hold.get(key);
    if (!share) return;
    let done = true;
    try {
      if (capture) done = await applyShare(planShare(share), library);
    } catch {
      return; // kept: the next time the Library opens sends it again
    }
    if (done) await hold.drop([key]);
  });
}

/**
 * Captures every held share that is sure to be a share, each once across
 * all open tabs. The ones that are not sure go to `ask` as soon as they are
 * read, whatever the others are doing, and wait for the person (see
 * judgeShare). Rejects when the hold cannot be read. A share whose hold
 * cannot be read or written goes to `fail` the moment it happens, and the
 * other Captures carry on.
 */
export async function drainShares(
  deps: Deps & {
    live: () => boolean;
    ask: (unsure: HeldShare[]) => void;
    fail: () => void;
  }
): Promise<void> {
  const { shares, unreadable } = await deps.hold.held();
  if (unreadable) deps.notify(REFUSAL_COPY.unreadable);
  deps.ask(shares.filter(({ share }) => !share.verified));
  await Promise.all(
    shares
      .filter(({ share }) => share.verified)
      .map(({ key }) =>
        decideShare({ ...deps, key, capture: true }).catch(deps.fail)
      )
  );
}
