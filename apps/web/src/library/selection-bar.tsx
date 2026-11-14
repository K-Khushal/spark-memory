import { useEffect, useRef, useState } from "react";
import { CATEGORY_NAMES, MAX_CATEGORIES } from "@spark/core";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  FilterChip,
} from "@spark/ui";

/** One bar: keyboard selection and its actions appear and leave at once. */
export function SelectionBar({
  count,
  ownNames,
  onClear,
  onDelete,
  onCategories,
}: {
  count: number;
  ownNames: string[];
  onClear: () => void;
  onDelete: () => void;
  onCategories: (categories: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const lastTile = useRef<Element | null>(null);
  useEffect(() => {
    lastTile.current = document.activeElement;
  }, []);
  useEffect(() => {
    const timer = setTimeout(
      () => setAnnouncement(`${count.toLocaleString()} Selected`),
      200
    );
    return () => clearTimeout(timer);
  }, [count]);
  // Escape clears from anywhere, unless a layer above (the Categories dialog, Search) took it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !open) onClear();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClear]);
  const finish = (action: () => void) => {
    if (lastTile.current instanceof HTMLElement && lastTile.current.isConnected)
      lastTile.current.focus();
    action();
    requestAnimationFrame(() => {
      if (
        lastTile.current instanceof HTMLElement &&
        lastTile.current.isConnected
      )
        lastTile.current.focus();
      else document.querySelector<HTMLElement>("main [data-index]")?.focus();
    });
  };
  return (
    <>
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <div
        role="region"
        aria-label="Selection"
        className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 mx-auto flex w-fit max-w-[calc(100%-2rem)] flex-wrap items-center justify-center gap-1 rounded-panel bg-surface p-2 text-sm text-ink shadow-overlay md:left-60"
      >
        <span className="px-2 tabular-nums">
          {count.toLocaleString()} Selected
        </span>
        <Button
          size="sm"
          className="min-h-11"
          variant="outline"
          onClick={() => finish(onDelete)}
        >
          Delete
        </Button>
        <Button
          size="sm"
          className="min-h-11"
          variant="outline"
          onClick={() => setOpen(true)}
        >
          Categories
        </Button>
        <Button
          size="sm"
          className="min-h-11"
          variant="quiet"
          onClick={() => finish(onClear)}
        >
          Clear
        </Button>
      </div>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setCategories([]);
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          className="max-h-[80dvh] overflow-y-auto p-6"
        >
          <DialogTitle>Categories</DialogTitle>
          <div className="flex flex-wrap gap-2 py-4">
            {[...CATEGORY_NAMES, ...ownNames].map((name) => (
              <FilterChip
                key={name}
                title={name}
                className="h-auto min-h-11 max-w-full py-2"
                aria-pressed={categories.includes(name)}
                disabled={
                  !categories.includes(name) &&
                  categories.length >= MAX_CATEGORIES
                }
                onClick={() =>
                  setCategories((now) =>
                    now.includes(name)
                      ? now.filter((c) => c !== name)
                      : [...now, name]
                  )
                }
              >
                <span className="min-w-0 wrap-anywhere text-start" dir="auto">
                  {name}
                </span>
              </FilterChip>
            ))}
          </div>
          <Button
            variant="primary"
            size="sm"
            className="min-h-11"
            disabled={!categories.length}
            onClick={() => {
              setOpen(false);
              finish(() => onCategories(categories));
              setCategories([]);
            }}
          >
            Set Categories
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
