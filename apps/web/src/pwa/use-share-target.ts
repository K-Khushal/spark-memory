import { useEffect } from "react";
import { toast } from "@spark/ui";
import { dropShares, heldShares } from "./hold";
import { applyShare, planShare } from "./share";

/**
 * Drains held shares into Capture once the Library is on screen. A share is
 * dropped only after Capture has it, and an effect that was cleaned up before
 * its read finished does nothing, so Strict Mode cannot lose or double one.
 */
export function useShareTarget(library: {
  capture: (text: string) => boolean;
  captureImages: (files: File[]) => Promise<void>;
}) {
  useEffect(() => {
    let live = true;
    void heldShares()
      .then((held) => {
        if (!live || !held.length) return;
        for (const { share } of held) {
          applyShare(planShare(share), library, (message) => toast(message));
        }
        return dropShares(held.map(({ key }) => key));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [library]);
}
