import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * A screen or section that has nothing to show, or failed: one heading and
 * one way forward, nothing else (DESIGN.md → Principles). `align="centre"`
 * is for a whole screen, `"start"` for a state inside a page (a search's
 * recovery next to its results). The Library's own h1 is out of sight, so it
 * passes `level={2}`.
 */
export function StateBlock({
  title,
  level = 2,
  align = "start",
  className,
  children,
}: {
  title: string;
  level?: 1 | 2 | 3;
  align?: "centre" | "start";
  className?: string;
  /** The one action: a Button, usually. */
  children?: ReactNode;
}) {
  const Heading = `h${level}` as const;
  return (
    <div
      data-slot="state-block"
      className={cn(
        "flex flex-col gap-4",
        align === "centre" ? "items-center text-center" : "items-start",
        className
      )}
    >
      <Heading className="font-display text-lg font-semibold text-balance">
        {title}
      </Heading>
      {children}
    </div>
  );
}
