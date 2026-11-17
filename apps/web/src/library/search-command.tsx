import { ImageQueryControls, type ImageQueryProps } from "./image-query";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useRecentSearches } from "./search-history";
import { restoreLibraryFocus } from "./focus";
import {
  ClockIcon,
  LogOutIcon,
  PlusIcon,
  RotateCwIcon,
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
import { KIND_ICONS, memoryName } from "./memory-tile";
import type { Memory } from "./use-library";
import type { Found, Results } from "./use-search";
import { searchList } from "./search-list";
import { whyLabel } from "./why";

/** The ⌘K palette: instant results, or Capture / Settings / Sign Out. */
export function SearchCommand({
  open,
  draft,
  imageQuery,
  instant,
  onRetry,
  retrying,
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
  onRetry: () => void;
  /** Between Try Again and the next answer. */
  retrying: boolean;
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

  const failure = retrying ? "Searching Again" : "Search Is Unreachable";
  // The last answer that had rows, kept while an empty instant answer waits
  // for the full one (searchList). Adjusted while rendering, as above.
  const [kept, setKept] = useState<Results>();
  const typed = !!(draft.trim() || visual);
  if (!open || !typed) {
    if (kept) setKept(undefined);
  } else if (
    instant &&
    instant !== "failed" &&
    instant.direct.length + instant.related.length > 0 &&
    kept !== instant
  )
    setKept(instant);
  const list =
    typed && instant && instant !== "failed"
      ? searchList(instant, kept)
      : undefined;
  /** What the list says in place of results; the screen reader hears it from outside the listbox. */
  const note =
    typed && instant
      ? instant === "failed"
        ? failure
        : list?.note
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
        {(imageButton) => (
          <CommandInput
            value={draft}
            onValueChange={onDraft}
            onKeyDown={forgetHighlighted}
            placeholder="Search…"
            className="text-[1rem] md:text-md"
            trailing={imageButton}
          />
        )}
      </ImageQueryControls>
      <CommandList
        ref={listRef}
        aria-busy={(retrying && instant === "failed") || !!list?.busy}
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
            <>
              <ListNote>{failure}</ListNote>
              <CommandGroup>
                <CommandItem
                  value="__retry"
                  aria-disabled={retrying || undefined}
                  onSelect={() => !retrying && onRetry()}
                >
                  <RotateCwIcon className="size-4 text-ink-muted" aria-hidden />
                  Try Again
                </CommandItem>
              </CommandGroup>
            </>
          ) : (
            list && (
              <>
                {list.note === "No Memories Match" && (
                  <ListNote>{list.note}</ListNote>
                )}
                {list.rows &&
                  (list.rows.direct.length ? (
                    <ResultGroup
                      heading="Direct Matches"
                      memories={list.rows.direct.slice(0, 6)}
                      onOpen={onOpen}
                    />
                  ) : (
                    list.note === "No Direct Matches" && (
                      <ListNote>{list.note}</ListNote>
                    )
                  ))}
                {list.rows && (
                  <ResultGroup
                    heading="Related Matches"
                    memories={list.rows.related.slice(0, 4)}
                    onOpen={onOpen}
                  />
                )}
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

/** The kind of a result, as a 16px mark at the start of its row. */
function KindIcon({ kind }: { kind: string }) {
  const Icon = KIND_ICONS[kind] ?? KIND_ICONS.text!;
  return <Icon className="size-4 shrink-0 text-ink-muted" aria-hidden />;
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
          <KindIcon kind={memory.kind} />
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
