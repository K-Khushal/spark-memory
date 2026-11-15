import {
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { DURATION } from "./tokens";
import { cn } from "./cn";

/**
 * A static placeholder block (DESIGN.md → Motion): sunken, tile radius, no
 * shimmer or pulse. Give it the size of what it stands in for.
 */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      data-slot="skeleton"
      className={cn("rounded-tile bg-sunken", className)}
      {...props}
    />
  );
}

/** A load shorter than this never shows a skeleton. */
export const SKELETON_DELAY = DURATION.preview;

/**
 * Shows `skeleton` while `loading`, but only once the wait passes 150ms, so a
 * quick load never flashes it. When the content arrives the skeleton fades out
 * over it in 150ms. Children render only when not loading. The wrapper is
 * `aria-busy` while loading and says "Loading" to assistive tech.
 */
export function SkeletonGate({
  loading,
  skeleton,
  children,
  label = "Loading",
  className,
}: {
  loading: boolean;
  skeleton: ReactNode;
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  const [waited, setWaited] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [wasLoading, setWasLoading] = useState(loading);
  if (wasLoading !== loading) {
    setWasLoading(loading);
    setLeaving(!loading && waited);
  }
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setWaited(true), SKELETON_DELAY);
    return () => clearTimeout(timer);
  }, [loading]);
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => {
      setLeaving(false);
      setWaited(false);
    }, DURATION.preview);
    return () => clearTimeout(timer);
  }, [leaving]);

  const layer = waited && (loading || leaving);
  return (
    <div className={cn("relative", className)} aria-busy={loading || undefined}>
      {!loading && children}
      {layer && (
        <div
          data-slot="skeleton-layer"
          data-leaving={!loading}
          className="bg-canvas"
          {...(loading && { role: "status" })}
        >
          <span className="sr-only">{label}</span>
          {skeleton}
        </div>
      )}
    </div>
  );
}
