import type { ComponentProps } from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { cn } from "./cn";

/**
 * A checkbox (shadcn/ui on Radix), restyled: control edge, ink fill when
 * checked, the check mark drawing itself in 120ms (styles.css). The 20px box
 * has a 44px hit area. Label it with a <label htmlFor> or aria-label.
 */
export function Checkbox({
  className,
  ...props
}: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "relative grid size-5 shrink-0 place-items-center rounded-chip border border-line-strong bg-surface text-canvas transition-[background-color,border-color] duration-(--duration-press) ease-out before:absolute before:-inset-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 data-[state=checked]:border-ink data-[state=checked]:bg-ink data-[state=indeterminate]:border-ink data-[state=indeterminate]:bg-ink",
        className
      )}
      {...props}
    >
      <svg
        viewBox="0 0 16 16"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path data-slot="checkbox-mark" pathLength={1} d="M3.5 8.5l3 3 6-7" />
      </svg>
    </CheckboxPrimitive.Root>
  );
}
