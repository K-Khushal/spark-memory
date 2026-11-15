import type { ComponentProps } from "react";
import { cn } from "./cn";

/** A keyboard key hint, e.g. <Kbd>⌘K</Kbd>. Hidden on a coarse pointer. */
export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
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
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control border border-line bg-surface px-3 text-sm pointer-coarse:min-h-(--size-touch) text-ink transition-[background-color,border-color,color,transform] duration-(--duration-press) ease-out select-none active:scale-[0.97] aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-canvas hover:border-line-strong",
        className
      )}
      {...props}
    />
  );
}

/**
 * A colour filter swatch; `name` is its accessible label. The button is the
 * hit box (28px, 44px on a coarse pointer); the painted dot stays 28px with a
 * `line-strong` edge, so White and Black both read on either canvas.
 */
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
        "group/swatch relative grid size-7 shrink-0 place-items-center rounded-control pointer-coarse:size-(--size-touch)",
        className
      )}
      {...props}
    >
      <span
        aria-hidden
        className="block size-full rounded-full shadow-[inset_0_0_0_1px_var(--line-strong)] transition-transform duration-(--duration-press) ease-out group-active/swatch:scale-[0.97] group-aria-pressed/swatch:ring-2 group-aria-pressed/swatch:ring-ink group-aria-pressed/swatch:ring-offset-2 group-aria-pressed/swatch:ring-offset-canvas pointer-coarse:size-7"
        style={{ backgroundColor: hex }}
      />
    </button>
  );
}
