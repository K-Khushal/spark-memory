import type { ComponentProps } from "react";
import { cn } from "./cn";

// shadcn/ui Input, restyled: 16px text so iOS does not zoom, a 3:1 edge
// because the edge is the control's only boundary (DESIGN.md → Colour).
export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 text-[1rem] text-ink transition-[border-color] duration-(--duration-press) ease-out placeholder:text-ink-muted disabled:opacity-50 aria-invalid:border-danger",
        className
      )}
      {...props}
    />
  );
}
