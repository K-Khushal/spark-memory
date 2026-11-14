import { ImageQueryControls, type ImageQueryProps } from "./image-query";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useRecentSearches } from "./search-history";
import { restoreLibraryFocus } from "./focus";
import {
  ClockIcon,
  LogOutIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Kbd,
} from "@spark/ui";
import { useFlip } from "./flip";
import { MOD } from "./shortcuts";
import { memoryName } from "./memory-tile";
import type { Memory } from "./use-library";
import type { Found, Results } from "./use-search";
import { whyLabel } from "./why";

/** The ⌘K palette: instant results, or Capture / Settings / Sign Out. */
export function SearchCommand({
  open,
  draft,
  imageQuery,
  instant,
  onOpenChange,
  onDraft,
  onShowOnWall,
  onOpen,
  onCapture,
  onSettings,
  onSignOut,
}: {
  open: boolean;
  imageQuery: ImageQueryProps;
  draft: string;
  instant: Results | "failed" | undefined;
  onOpenChange: (open: boolean) => void;
  onDraft: (value: string) => void;
  onShowOnWall: (query: string) => void;
  onOpen: (memory: Memory) => void;
  onCapture: () => void;
  onSettings: () => void;
  onSignOut: () => void;
}) {
  const visual = imageQuery.value;
  const { recent, forget } = useRecentSearches(open);
  const listRef = useRef<HTMLDivElement>(null);
  // The highlighted row. With nothing typed it starts on the row Enter should
  // take: Search By Image once there is an image, else the first Recent
  // search (arriving after the menu opened), so Delete has something to act on.
  const [highlight, setHighlight] = useState("");
  const firstRecent = recent[0] && `recent:${recent[0].id}`;
  const [started, setStarted] = useState<string>();
  const row = open && !draft ? (visual ? "__wall" : firstRecent) : undefined;
  const start = row && `${visual?.id ?? ""}|${row}`;
  if (start !== started) {
    // Adjusted while rendering, once per change (React's pattern for state
    // that follows props).
    setStarted(start);
    if (row) setHighlight(row);
  }
  /** Delete or ⌘⌫ forgets the highlighted Recent search (the box is empty then, so they delete nothing else). */
  const forgetHighlighted = (event: KeyboardEvent<HTMLInputElement>) => {
    const keys =
      event.key === "Delete" ||
      (event.key === "Backspace" && (event.metaKey || event.ctrlKey));
    if (!keys || draft || !highlight.startsWith("recent:")) return;
    event.preventDefault();
    void forget(highlight.slice("recent:".length));
  };
  useFlip(
    listRef,
    instant && instant !== "failed"
      ? [...instant.direct, ...instant.related].map((m) => m.id).join()
      : "",
    draft.trim()
  );

  /** What the list says in place of results; the screen reader hears it from outside the listbox. */
  const note =
    (draft.trim() || visual) && instant
      ? instant === "failed"
        ? "Search Is Unreachable"
        : instant.direct.length === 0
          ? "No Direct Matches"
          : undefined
      : undefined;

  return (
    <CommandDialog
      onCloseAutoFocus={restoreLibraryFocus}
      title="Search"
      open={open}
      onOpenChange={onOpenChange}
      shouldFilter={false}
      value={highlight}
      onValueChange={setHighlight}
    >
      <ImageQueryControls {...imageQuery}>
        <CommandInput
          value={draft}
          onValueChange={onDraft}
          onKeyDown={forgetHighlighted}
          placeholder="Search…"
          className="pr-10 text-[1rem] md:text-md"
        />
      </ImageQueryControls>
      <CommandList
        ref={listRef}
        data-search-mode={
          instant && instant !== "failed" ? instant.mode : undefined
        }
        data-search-key={
          instant && instant !== "failed" ? instant.key : undefined
        }
      >
        {(draft.trim() || visual) && (
          <CommandItem value="__wall" onSelect={() => onShowOnWall(draft)}>
            <SearchIcon className="size-4 text-ink-muted" aria-hidden />
            <span className="min-w-0 flex-1 truncate" dir="auto">
              {draft || "Search By Image"}
            </span>
            <Kbd>↵</Kbd>
          </CommandItem>
        )}
        {draft.trim() || visual ? (
          instant === "failed" ? (
            <ListNote>Search Is Unreachable</ListNote>
          ) : instant &&
            instant.direct.length + instant.related.length === 0 ? (
            <ListNote>No Direct Matches</ListNote>
          ) : (
            instant && (
              <>
                {instant.direct.length ? (
                  <ResultGroup
                    heading="Direct Matches"
                    memories={instant.direct.slice(0, 6)}
                    onOpen={onOpen}
                  />
                ) : (
                  <ListNote>No Direct Matches</ListNote>
                )}
                <ResultGroup
                  heading="Related Matches"
                  memories={instant.related.slice(0, 4)}
                  onOpen={onOpen}
                />
              </>
            )
          )
        ) : (
          <>
            {recent.length > 0 && (
              <CommandGroup heading="Recent Searches">
                {recent.map((s) => (
                  <CommandItem
                    key={s.id}
                    value={`recent:${s.id}`}
                    className="group/recent min-w-0"
                    aria-keyshortcuts="Delete Control+Backspace Meta+Backspace"
                    onSelect={() => onShowOnWall(s.query)}
                  >
                    <ClockIcon
                      className="size-4 shrink-0 text-ink-muted"
                      aria-hidden
                    />
                    <span
                      className="min-w-0 flex-1 truncate"
                      dir="auto"
                      title={s.query}
                    >
                      {s.query}
                    </span>
                    {/* For the mouse only: the keyboard deletes the highlighted
                        row (onKeyDown below), so this is not an extra control
                        inside the list. */}
                    <span
                      aria-hidden
                      data-delete-recent
                      className="grid size-6 shrink-0 place-items-center rounded-control text-ink-muted opacity-0 group-hover/recent:opacity-100 group-data-[selected=true]/recent:opacity-100 pointer-coarse:opacity-100 hover:bg-line hover:text-ink [&_svg]:size-4"
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={(event) => {
                        event.stopPropagation();
                        void forget(s.id);
                      }}
                    >
                      <XIcon />
                    </span>
                  </CommandItem>
                ))}
                <CommandItem
                  value="__clear_recent"
                  onSelect={() => void forget()}
                >
                  <Trash2Icon className="size-4 text-ink-muted" aria-hidden />
                  Clear Recent Searches
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              <Action icon={<PlusIcon />} hint={`${MOD}V`} onSelect={onCapture}>
                Capture
              </Action>
              <Action icon={<SettingsIcon />} onSelect={onSettings}>
                Settings
              </Action>
              <Action icon={<LogOutIcon />} onSelect={onSignOut}>
                Sign Out
              </Action>
            </CommandGroup>
          </>
        )}
      </CommandList>
      <div role="status" className="sr-only">
        {note}
      </div>
    </CommandDialog>
  );
}

/**
 * A line in the ⌘K list where results would be. A listbox may hold only
 * options and groups, so it is drawn here and read out by the live region
 * after the list (`note` below).
 */
function ListNote({ children }: { children: string }) {
  return (
    <div aria-hidden className="py-6 text-center text-sm text-ink-muted">
      {children}
    </div>
  );
}

function ResultGroup({
  memories,
  heading,
  onOpen,
}: {
  heading: string;
  memories: Found[];
  onOpen: (memory: Memory) => void;
}) {
  if (!memories.length) return null;
  return (
    <CommandGroup heading={heading}>
      {memories.map((memory) => (
        <CommandItem
          key={memory.id}
          value={memory.id}
          data-flip={memory.id}
          onSelect={() => onOpen(memory)}
        >
          <span className="min-w-0 flex-1 truncate" dir="auto">
            {memoryName(memory)}
          </span>
          <span
            className="max-w-32 truncate text-xs text-ink-muted"
            title={whyLabel(memory)}
          >
            {whyLabel(memory)}
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

function Action({
  icon,
  hint,
  onSelect,
  children,
}: {
  icon: ReactNode;
  hint?: string;
  onSelect: () => void;
  children: string;
}) {
  return (
    <CommandItem value={children} onSelect={onSelect}>
      <span className="text-ink-muted [&_svg]:size-4" aria-hidden>
        {icon}
      </span>
      <span className="flex-1">{children}</span>
      {hint && <Kbd>{hint}</Kbd>}
    </CommandItem>
  );
}
