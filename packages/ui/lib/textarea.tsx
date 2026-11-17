import type { ComponentProps } from "react";
import { cn } from "./cn";

// shadcn/ui Textarea, restyled like Input: 16px text so iOS does not zoom,
// grows with its content up to the parent's limit.
export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "field-sizing-content min-h-24 w-full min-w-0 resize-none rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[1rem] text-ink transition-[border-color] duration-(--duration-press) ease-out outline-none placeholder:text-ink-muted focus-visible:border-ink focus-visible:shadow-[inset_0_0_0_1px_var(--ink)] disabled:opacity-50 aria-invalid:border-danger aria-invalid:focus-visible:shadow-[inset_0_0_0_1px_var(--danger)]",
        className
      )}
      {...props}
    />
  );
}
