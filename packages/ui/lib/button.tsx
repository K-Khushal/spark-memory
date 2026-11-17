import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "./cn";

// shadcn/ui Button, restyled from DESIGN.md: press feedback on pointer-down,
// colour-only hover behind (hover: hover), no `transition-all`. A disabled
// primary recedes to `sunken` with muted text; `danger` is quiet in red. A coarse
// pointer gets a 44px target while the icon stays 16px. `wrap` lets a long
// label (or 200% text) grow the button instead of clipping it.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-control font-medium whitespace-nowrap select-none transition-[background-color,color,transform] duration-(--duration-press) ease-out active:scale-[0.97] disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary:
          "bg-ink text-canvas hover:bg-ink/85 disabled:bg-sunken disabled:text-ink-muted disabled:opacity-100 disabled:shadow-[inset_0_0_0_1px_var(--edge)]",
        quiet:
          "text-ink aria-pressed:bg-sunken hover:bg-sunken disabled:opacity-50",
        outline:
          "border border-line-strong bg-surface text-ink hover:bg-sunken disabled:opacity-50",
        danger: "text-danger hover:bg-sunken disabled:opacity-50",
      },
      size: {
        sm: "h-8 min-h-8 px-3 text-sm pointer-coarse:min-h-(--size-touch)",
        md: "h-9 min-h-9 px-4 text-sm pointer-coarse:min-h-(--size-touch)",
        icon: "size-9 pointer-coarse:size-(--size-touch)",
        "icon-sm": "size-8 pointer-coarse:size-(--size-touch)",
      },
      wrap: {
        true: "h-auto max-w-full py-2 text-start whitespace-normal",
        false: "",
      },
    },
    defaultVariants: { variant: "quiet", size: "md", wrap: false },
  }
);

export function Button({
  className,
  variant,
  size,
  wrap,
  asChild = false,
  ...props
}: ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, wrap, className }))}
      {...props}
    />
  );
}
