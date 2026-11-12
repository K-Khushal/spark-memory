import type { HeldShare, PendingShare } from "./hold";
import { applyShare, planShare, type ShareLibrary } from "./share";

/** The hold, as the drain needs it (hold.ts holds the IndexedDB one). */
export type Hold = {
  held: () => Promise<HeldShare[]>;
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
 * has it, or, with `capture: false`, drops it unseen. The lock queues tabs;
 * the check that the share is still held means a tab that waited finds it
 * already done. A tab that closes mid-Capture frees the lock and leaves the
 * share held, so the next tab sends it again under the same Capture id and
 * the server's idempotent create makes no second Memory. Without Web Locks
 * two claims can both run; the stable id covers that too.
 */
export function decideShare({
  hold,
  locks,
  library,
  notify,
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
    try {
      if (capture) await applyShare(planShare(share), library, notify);
      await hold.drop([key]);
    } catch {
      // Kept: the next time the Library opens sends it again.
    }
  });
}

/**
 * Captures every held share that is sure to be a share, each once across
 * all open tabs. Returns the ones that are not sure, which wait for the
 * person (see judgeShare).
 */
export async function drainShares(
  deps: Deps & { live: () => boolean }
): Promise<HeldShare[]> {
  const held = await deps.hold.held();
  const sure = held.filter(({ share }) => share.verified);
  await Promise.all(
    sure.map(({ key }) => decideShare({ ...deps, key, capture: true }))
  );
  return held.filter(({ share }) => !share.verified);
}
