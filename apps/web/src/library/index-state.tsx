import { useId } from "react";
import { RotateCwIcon } from "lucide-react";
import { isPartlyIndexed, type IndexFailure } from "@spark/core";
import { Button, cn, Switch } from "@spark/ui";
import type { Memory } from "./library-actions";

/** Index state controls, for Memory detail and the image viewer. */
export type IndexingProps = {
  onRetryIndexing: (memory: Memory) => void;
  onAiOptOut: (memory: Memory, on: boolean) => void;
};

const FAILURE_LABEL: Record<IndexFailure, string> = {
  unavailable: "Indexing Unavailable",
  invalid_output: "Could Not Be Described",
  unreadable: "Image Could Not Be Read",
};

/** Why Indexing failed, as Retry and Memory detail say it. */
export const failureReason = (memory: Memory) =>
  memory.kind === "pdf" && memory.indexError === "unreadable"
    ? "PDF Could Not Be Read"
    : (FAILURE_LABEL[memory.indexError as IndexFailure] ??
      FAILURE_LABEL.unavailable);

/**
 * Index state while it is not Searchable (DESIGN.md → Colour): Indexing, or
 * Failed with Retry, whose label carries the reason. No badge once
 * Searchable. `plate` is the fixed dark plate badges use over images;
 * `withReason` says why in place of "Failed" (the image viewer, which has
 * no Memory detail).
 */
export function IndexBadge({
  memory,
  onRetry,
  focusable = true,
  plate = false,
  withReason = false,
  className,
}: {
  memory: Memory;
  onRetry: () => void;
  focusable?: boolean;
  plate?: boolean;
  withReason?: boolean;
  className?: string;
}) {
  if (memory.indexState === "searchable") return null;
  const failed = memory.indexState === "failed";
  const reason = failureReason(memory);
  return (
    <span
      data-theme={plate ? "dark" : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-chip px-2 text-xs font-medium",
        plate ? "h-7 bg-canvas/80" : "h-6 bg-surface shadow-raised",
        failed ? "pr-1 text-danger" : "text-indexing",
        className
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5", failed ? "bg-danger" : "bg-indexing")}
      />
      {failed ? (withReason ? reason : "Failed") : "Indexing"}
      {failed && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRetry();
          }}
          // Keep Enter and Space from also opening the Memory.
          onKeyDown={(e) => e.stopPropagation()}
          aria-label={`Retry, ${reason}`}
          title={reason}
          tabIndex={focusable ? undefined : -1}
          className="relative grid size-5 place-items-center rounded-[4px] text-ink transition-[background-color,transform] duration-(--duration-press) ease-out hover:bg-sunken focus-visible:outline-2 focus-visible:outline-ring active:scale-[0.97] before:absolute before:-inset-2.5"
        >
          <RotateCwIcon className="size-3.5" aria-hidden />
        </button>
      )}
    </span>
  );
}

/** A PDF past the Free allowance, Searchable by its first pages only. */
export const isPartly = (memory: Memory) =>
  memory.kind === "pdf" &&
  memory.indexState === "searchable" &&
  isPartlyIndexed(memory.pages);

/**
 * "Partly Indexed" on a PDF's tile, where the Index state badge sits once
 * it is Searchable. Quiet: the same plate as the other badges over imagery,
 * with no dot and no colour, because nothing is wrong.
 */
export function PartlyIndexedBadge({ className }: { className?: string }) {
  return (
    <span
      data-theme="dark"
      className={cn(
        "inline-flex h-7 items-center rounded-chip bg-canvas/80 px-2 text-xs font-medium whitespace-nowrap text-ink",
        className
      )}
    >
      Partly Indexed
    </span>
  );
}

/** AI opt-out (GLOSSARY.md): on, this Memory never reaches an AI provider. */
export function AiOptOutSwitch({
  memory,
  onChange,
}: {
  memory: Memory;
  onChange: (memory: Memory, on: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <Switch
        id={id}
        checked={memory.aiOptOut}
        onCheckedChange={(on) => onChange(memory, on)}
      />
      <label
        htmlFor={id}
        className="text-sm whitespace-nowrap text-ink select-none"
      >
        AI Opt-Out
      </label>
    </div>
  );
}

/**
 * Memory detail's line for Index state: Indexing, or why it failed. Always
 * mounted, so screen readers hear each change.
 */
export function IndexStatus({ memory }: { memory: Memory }) {
  const failed = memory.indexState === "failed";
  return (
    <span
      role="status"
      className={cn("text-sm", failed ? "text-danger" : "text-indexing")}
    >
      {failed
        ? failureReason(memory)
        : memory.indexState === "indexing"
          ? "Indexing"
          : ""}
    </span>
  );
}

const DEEP_FETCH_LABEL = {
  fetching: "Fetching",
  waiting: "Fetching Later",
  failed: "Deep Fetch Failed",
} as const;

/**
 * Memory detail's line for Deep fetch, only while there is something to say:
 * Fetching, Fetching Later (a retry or a limit is waiting), or Failed with
 * Try Again. An engine that is not set up shows nothing: that is the
 * operator's to fix, not the person's. Quiet text, because the Failed and Indexing
 * colours belong to Index state. Always mounted when shown, so screen
 * readers hear each change.
 */
export function DeepFetchStatus({
  memory,
  onTryAgain,
}: {
  memory: Memory;
  onTryAgain: (memory: Memory) => void;
}) {
  if (!memory.deepFetch) return null;
  const stopped = memory.deepFetch === "failed";
  return (
    // One unit, so Try Again never wraps away from what failed.
    <span className="inline-flex items-center gap-2">
      <span role="status" className="text-sm whitespace-nowrap text-ink-muted">
        {DEEP_FETCH_LABEL[memory.deepFetch]}
      </span>
      {stopped && (
        <Button variant="quiet" size="sm" onClick={() => onTryAgain(memory)}>
          <RotateCwIcon aria-hidden /> Try Again
        </Button>
      )}
    </span>
  );
}
