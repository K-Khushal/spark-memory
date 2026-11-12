import { useEffect } from "react";
import { toast } from "@spark/ui";
import { dropShares, heldShares } from "./hold";
import { applyShare, planShare, type ShareLibrary } from "./share";

/**
 * Drains held shares into Capture once the Library is on screen. A share is
 * dropped once Capture has finished with it (a refusal is a toast, not a retry), and an effect that was cleaned up before
 * its read finished does nothing, so Strict Mode cannot lose or double one.
 */
export function useShareTarget(library: ShareLibrary) {
  useEffect(() => {
    let live = true;
    void heldShares()
      .then(async (held) => {
        if (!live || !held.length) return;
        for (const { share } of held) {
          await applyShare(planShare(share), library, (message) =>
            toast(message)
          );
        }
        await dropShares(held.map(({ key }) => key));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [library]);
}
