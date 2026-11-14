import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * Confirm feedback: the `from` icon (Copy) gives way to the `to` icon (Check)
 * when `on` turns true, as a 150ms cross-fade (styles.css). Decorative: say
 * the result in text or a status for assistive tech.
 */
export function CrossfadeIcon({
  on,
  from,
  to,
  className,
}: {
  on: boolean;
  from: ReactNode;
  to: ReactNode;
  className?: string;
}) {
  return (
    <span
      data-slot="crossfade"
      data-on={on}
      aria-hidden
      className={cn("relative inline-grid size-4 shrink-0", className)}
    >
      <span data-face="from" className="grid place-items-center">
        {from}
      </span>
      <span data-face="to" className="grid place-items-center">
        {to}
      </span>
    </span>
  );
}
