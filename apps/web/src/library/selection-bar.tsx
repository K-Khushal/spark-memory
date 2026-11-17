import { useEffect, useRef, useState } from "react";
import { TagsIcon, Trash2Icon, XIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { DURATION, EASING } from "@spark/ui/tokens";
import { CATEGORY_NAMES, MAX_CATEGORIES } from "@spark/core";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  inputModality,
  useBottomObstruction,
  DialogTitle,
  FilterChip,
} from "@spark/ui";

/** One bar: pointer entry rises once; keyboard entry and every exit are immediate. */
export function SelectionBar({
  count,
  onHeight,
  ownNames,
  onClear,
  onDelete,
  onCategories,
}: {
  count: number;
  onHeight?: (height: number) => void;
  ownNames: string[];
  onClear: () => void;
  onDelete: () => void;
  onCategories: (categories: string[]) => void;
}) {
  const reduced = useReducedMotion();
  const bar = useRef<HTMLDivElement>(null);
  useBottomObstruction(bar);
  // Content needs the same clearance; the shared hook owns toast placement.
  useEffect(() => {
    const element = bar.current;
    if (!element || !onHeight) return;
    const measure = () => onHeight(element.getBoundingClientRect().height);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => {
      observer.disconnect();
      onHeight(0);
    };
  }, [onHeight]);
  const [keyboard] = useState(() => inputModality() === "keyboard");
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
      <motion.div
        ref={bar}
        initial={keyboard ? false : { opacity: 0, y: reduced ? 0 : 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DURATION.press / 1000, ease: EASING.out }}
        role="region"
        aria-label="Selection"
        className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-30 mx-auto flex w-fit max-w-[calc(100%-2rem)] flex-wrap items-center justify-center gap-2 rounded-panel bg-surface p-2 text-sm text-ink shadow-overlay md:left-60"
      >
        <span className="px-2 whitespace-nowrap tabular-nums">
          {count.toLocaleString()} Selected
        </span>
        {/* On a phone the two actions are icons (their words stay as the
            names), so the count and all three controls fit one row at 320px. */}
        <Button
          wrap
          variant="quiet"
          className="max-sm:size-11 max-sm:min-h-11 max-sm:p-0"
          onClick={() => setOpen(true)}
        >
          <TagsIcon aria-hidden />{" "}
          <span className="max-sm:sr-only">Categories</span>
        </Button>
        <Button
          wrap
          variant="quiet"
          className="max-sm:size-11 max-sm:min-h-11 max-sm:p-0"
          onClick={() => finish(onDelete)}
        >
          <Trash2Icon aria-hidden />{" "}
          <span className="max-sm:sr-only">Delete</span>
        </Button>
        <Button
          variant="quiet"
          size="icon"
          className="max-sm:size-11"
          aria-label="Clear"
          onClick={() => finish(onClear)}
        >
          <XIcon aria-hidden />
        </Button>
      </motion.div>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setCategories([]);
        }}
      >
        <DialogContent
          presentation="sheet"
          aria-describedby={undefined}
          className="flex max-h-[80dvh] flex-col overflow-hidden"
        >
          <DialogHeader>
            <DialogTitle className="wrap-anywhere">Categories</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <div className="flex flex-wrap gap-2">
              {[...CATEGORY_NAMES, ...ownNames].map((name) => (
                <FilterChip
                  key={name}
                  title={name}
                  className="h-auto min-h-8 max-w-full py-1.5"
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
          </DialogBody>
          <DialogFooter>
            <Button
              wrap
              variant="primary"
              disabled={!categories.length}
              onClick={() => {
                setOpen(false);
                finish(() => onCategories(categories));
                setCategories([]);
              }}
            >
              Set Categories
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
