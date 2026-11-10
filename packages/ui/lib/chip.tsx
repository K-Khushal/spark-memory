import type { ComponentProps } from "react";
import { cn } from "./cn";

/** A keyboard key hint, e.g. <Kbd>⌘K</Kbd>. */
export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-chip border border-line bg-surface px-1 font-sans text-2xs font-medium text-ink-muted tabular select-none",
        className
      )}
      {...props}
    />
  );
}

/**
 * A small read-only label. `why` explains a search result ("colour: orange");
 * `spark` marks a Direct match. Never interactive: use FilterChip for that.
 */
export function Chip({
  className,
  tone = "why",
  ...props
}: ComponentProps<"span"> & { tone?: "why" | "spark" }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-chip px-2 text-xs font-medium whitespace-nowrap",
        "[&>span]:truncate",
        tone === "why" && "bg-sunken text-ink-muted",
        tone === "spark" && "bg-spark text-on-spark",
        className
      )}
      {...props}
    />
  );
}

/** A toggle filter. Pass aria-pressed for its on state. */
export function FilterChip({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control border border-line bg-surface px-3 text-sm text-ink transition-[background-color,border-color,color,transform] duration-[120ms] ease-out select-none active:scale-[0.97] aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-canvas hover:border-line-strong",
        className
      )}
      {...props}
    />
  );
}

/** A colour filter swatch; `name` is its accessible label. */
export function Swatch({
  hex,
  name,
  className,
  ...props
}: ComponentProps<"button"> & { hex: string; name: string }) {
  return (
    <button
      type="button"
      aria-label={name}
      title={name}
      className={cn(
        "relative size-7 shrink-0 rounded-full shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ink)_22%,transparent)] transition-transform duration-[120ms] ease-out active:scale-[0.97] aria-pressed:ring-2 aria-pressed:ring-ink aria-pressed:ring-offset-2 aria-pressed:ring-offset-canvas",
        className
      )}
      style={{ backgroundColor: hex }}
      {...props}
    />
  );
}
