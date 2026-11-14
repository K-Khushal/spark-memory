import { useEffect, useState } from "react";
import { Button, Dialog, DialogContent, DialogTitle, toast } from "@spark/ui";
import { decideShare, drainShares } from "./drain";
import {
  dropShares,
  heldShare,
  heldShares,
  type HeldShare,
  type PendingShare,
} from "./hold";
import { REFUSAL_COPY } from "./refusal";
import { planShare, type ShareLibrary } from "./share";

const hold = { held: heldShares, get: heldShare, drop: dropShares };
const notify = (message: string) => toast(message);

/** What a share holds, in a few words, for the person to judge. */
export function previewOf(share: PendingShare): string {
  const plan = planShare(share);
  const files = [...plan.images, ...plan.pdfs].map(({ file }) => file.name);
  return files.length ? files.join(", ") : (plan.link ?? plan.text ?? "");
}

/** A failure of the hold is said once, with Try Again. */
const retryable = (message: string, retry: () => void) =>
  toast(message, {
    id: "share-hold",
    duration: 8000,
    action: { label: "Try Again", onClick: retry },
  });

/**
 * Captures held shares once the Library is on screen, and only while it is:
 * an effect that was cleaned up before its turn does nothing, so Strict Mode
 * cannot start one twice. A share that a web page could have sent waits here
 * for the person to Capture or Discard it (closing the question keeps it),
 * whatever the other Captures are doing. A hold that cannot be read or
 * written keeps the share and says so. See drainShares for how tabs share
 * the work.
 */
export function ShareTarget({ library }: { library: ShareLibrary }) {
  const [asked, setAsked] = useState<HeldShare[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    const retry = () =>
      retryable(REFUSAL_COPY.unreadable, () => setAttempt((n) => n + 1));
    drainShares({
      hold,
      locks: navigator.locks,
      library,
      notify,
      live: () => live,
      ask: (unsure) => live && setAsked(unsure),
      fail: retry,
    }).catch(retry);
    return () => {
      live = false;
    };
  }, [library, attempt]);

  const decide = (key: IDBValidKey, capture: boolean) =>
    decideShare({ hold, locks: navigator.locks, library, notify, key, capture })
      .then(() => {})
      .catch(() =>
        retryable(REFUSAL_COPY.storage, () => void decide(key, capture))
      );

  const next = asked[0];
  const answer = (capture: boolean) => {
    if (!next) return;
    setAsked((all) => all.slice(1));
    void decide(next.key, capture);
  };

  return (
    <Dialog
      open={!!next}
      // Closing leaves the share held: it asks again the next time Spark opens.
      onOpenChange={(open) => !open && setAsked((all) => all.slice(1))}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        aria-describedby={undefined}
      >
        <div className="flex flex-col gap-4 p-5">
          <DialogTitle className="pr-8">Capture This Share?</DialogTitle>
          <p
            role="region"
            aria-label="Shared Text"
            tabIndex={0}
            className="max-h-[40dvh] overflow-y-auto overscroll-contain rounded-chip text-sm whitespace-pre-wrap wrap-anywhere text-ink-muted"
          >
            {next && previewOf(next.share)}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => answer(false)}>
              Discard
            </Button>
            <Button variant="primary" onClick={() => answer(true)}>
              Capture
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
