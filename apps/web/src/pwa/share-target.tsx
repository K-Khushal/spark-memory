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
import { planShare, type ShareLibrary } from "./share";

const hold = { held: heldShares, get: heldShare, drop: dropShares };
const notify = (message: string) => toast(message);

/** What a share holds, in a few words, for the person to judge. */
export function previewOf(share: PendingShare): string {
  const plan = planShare(share);
  const files = [...plan.images, ...plan.pdfs].map(({ file }) => file.name);
  return files.length ? files.join(", ") : (plan.link ?? plan.text ?? "");
}

/**
 * Captures held shares once the Library is on screen, and only while it is:
 * an effect that was cleaned up before its turn does nothing, so Strict Mode
 * cannot start one twice. A share that a web page could have sent waits here
 * for the person to Capture or Discard it (closing the question keeps it). See drainShares for how tabs
 * share the work.
 */
export function ShareTarget({ library }: { library: ShareLibrary }) {
  const [asked, setAsked] = useState<HeldShare[]>([]);

  useEffect(() => {
    let live = true;
    drainShares({
      hold,
      locks: navigator.locks,
      library,
      notify,
      live: () => live,
    })
      .then((unsure) => live && setAsked(unsure))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [library]);

  const next = asked[0];
  const answer = (capture: boolean) => {
    if (!next) return;
    setAsked((all) => all.slice(1));
    void decideShare({
      hold,
      locks: navigator.locks,
      library,
      notify,
      key: next.key,
      capture,
    });
  };

  return (
    <Dialog
      open={!!next}
      // Closing leaves the share held: it asks again the next time Spark opens.
      onOpenChange={(open) => !open && setAsked((all) => all.slice(1))}
    >
      <DialogContent>
        <div className="flex flex-col gap-4 p-5">
          <DialogTitle>Capture This Share?</DialogTitle>
          <p className="line-clamp-6 text-sm [overflow-wrap:anywhere] whitespace-pre-wrap text-ink-muted">
            {next && previewOf(next.share)}
          </p>
          <div className="flex justify-end gap-2">
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
