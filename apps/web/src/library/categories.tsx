import { useState } from "react";
import { CATEGORY_NAMES, MAX_CATEGORIES } from "@spark/core";
import { ChevronDownIcon, Clock3Icon, TagsIcon } from "lucide-react";
import { Button, FilterChip } from "@spark/ui";
import { useOwnCategoryNames } from "./own-categories";
import type { Memory } from "./use-library";

export type CategoryEdit = (
  memory: Memory,
  categories: string[]
) => Promise<boolean>;

/**
 * A Memory's Categories, one to three, opening to change them. Apply is the
 * deliberate step that locks them against automatic changes; a failed save
 * keeps the choice for another try.
 */
export function CategoryEditor({
  memory,
  onSave,
  compact = false,
}: {
  memory: Memory;
  onSave?: CategoryEdit;
  /** Fixed-width control for viewer toolbars; the accessible name keeps the Categories. */
  compact?: boolean;
}) {
  const [selected, setSelected] = useState<string[]>(memory.categories);
  const [state, setState] = useState<"idle" | "saving" | "failed">("idle");
  const own = useOwnCategoryNames();
  const pending = memory.categoriesVersion === null && !memory.categoriesLocked;
  const label = pending ? "Categorising" : memory.categories.join(", ");
  if (!onSave) return null;
  const toggle = (name: string) =>
    setSelected((now) =>
      now.includes(name)
        ? now.filter((c) => c !== name)
        : now.length < MAX_CATEGORIES
          ? [...now, name]
          : now
    );
  return (
    <details
      className="group relative shrink-0 rounded-control bg-sunken px-3 py-1 text-sm text-ink"
      onToggle={(e) => {
        if (e.currentTarget.open) {
          setSelected(memory.categories);
          setState("idle");
        }
      }}
    >
      <summary
        aria-label={`Categories: ${label}`}
        className="flex min-h-8 cursor-pointer items-center justify-between gap-2 rounded-chip focus-visible:outline-2 focus-visible:outline-ring"
      >
        {compact ? (
          <>
            {pending ? (
              <Clock3Icon aria-hidden className="size-4 text-ink-muted" />
            ) : (
              <TagsIcon aria-hidden className="size-4" />
            )}
            <span className="sr-only">{label}</span>
          </>
        ) : (
          <span
            className={`min-w-0 wrap-anywhere${pending ? " text-ink-muted" : ""}`}
            dir="auto"
          >
            {label}
          </span>
        )}
        {!compact && (
          <ChevronDownIcon
            aria-hidden
            className="size-4 shrink-0 text-ink-muted transition-transform duration-(--duration-press) group-open:rotate-180 motion-reduce:transition-none"
          />
        )}
      </summary>
      <div
        className={
          compact
            ? "fixed inset-x-4 top-16 z-20 mt-2 max-h-[60dvh] overflow-y-auto rounded-panel bg-surface p-3 shadow-overlay sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:w-72"
            : undefined
        }
      >
        <div className="flex flex-wrap gap-2 py-2">
          {[...CATEGORY_NAMES, ...own].map((name) => (
            <FilterChip
              key={name}
              aria-pressed={selected.includes(name)}
              aria-disabled={
                !selected.includes(name) && selected.length >= MAX_CATEGORIES
              }
              disabled={state === "saving"}
              className="h-auto min-h-8 max-w-full py-1 aria-disabled:opacity-50"
              onClick={() => toggle(name)}
            >
              <span className="min-w-0 wrap-anywhere text-start" dir="auto">
                {name}
              </span>
            </FilterChip>
          ))}
        </div>
        <div className="flex items-center gap-3 pb-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!selected.length || state === "saving"}
            onClick={async (event) => {
              const details = event.currentTarget.closest("details");
              setState("saving");
              const saved = await onSave(memory, selected);
              setState(saved ? "idle" : "failed");
              if (saved && details) details.open = false;
            }}
          >
            {state === "failed" ? "Try Again" : "Apply"}
          </Button>
          {state === "failed" && (
            <span role="alert" className="text-ink-muted">
              Not Saved
            </span>
          )}
        </div>
      </div>
    </details>
  );
}
