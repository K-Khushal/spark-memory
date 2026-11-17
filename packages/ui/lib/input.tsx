import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";

// shadcn/ui Input, restyled: 16px text so iOS does not zoom, a 3:1 edge
// because the edge is the control's only boundary (DESIGN.md → Colour). Focus
// is a 2px ink edge with no offset (`Textarea` and `InputOTP` match). This is
// the one field look: `size="sm"` is the compact row height.
const inputVariants = cva(
  "w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 text-ink transition-[border-color] duration-(--duration-press) ease-out outline-none placeholder:text-ink-muted focus-visible:border-ink focus-visible:shadow-[inset_0_0_0_1px_var(--ink)] disabled:opacity-50 aria-invalid:border-danger aria-invalid:focus-visible:shadow-[inset_0_0_0_1px_var(--danger)]",
  {
    variants: {
      size: {
        md: "h-11 text-[1rem]",
        sm: "h-9 text-[1rem] pointer-fine:text-sm pointer-coarse:h-11",
      },
    },
    defaultVariants: { size: "md" },
  }
);

export function Input({
  className,
  size,
  ...props
}: Omit<ComponentProps<"input">, "size"> & VariantProps<typeof inputVariants>) {
  return (
    <input
      data-slot="input"
      className={cn(inputVariants({ size }), className)}
      {...props}
    />
  );
}
