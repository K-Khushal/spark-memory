import { api } from "../api";
import type { RecentSearch } from "./search-history";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LogOutIcon, PlusIcon, SearchIcon, SettingsIcon } from "lucide-react";
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Kbd,
  toast,
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
  const recentEpoch = useRef(0);
  const [recent, setRecent] = useState<RecentSearch[]>([]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    const epoch = ++recentEpoch.current;
    void api.api.search.recent
      .$get()
      .then(async (r) => {
        if (r.ok) {
          const body = await r.json();
          if (active && epoch === recentEpoch.current) setRecent(body.searches);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [open]);
  const forget = async (id?: string) => {
    recentEpoch.current++;
    try {
      const response = id
        ? await api.api.search.recent[":id"].$delete({ param: { id } })
        : await api.api.search.recent.$delete();
      if (response.ok)
        setRecent((all) => (id ? all.filter((s) => s.id !== id) : []));
      else throw new Error("delete failed");
    } catch {
      toast.error("Could Not Delete Search", {
        action: { label: "Try Again", onClick: () => void forget(id) },
      });
    }
  };
  const listRef = useRef<HTMLDivElement>(null);
  useFlip(
    listRef,
    instant && instant !== "failed"
      ? [...instant.direct, ...instant.related].map((m) => m.id).join()
      : "",
    draft.trim()
  );

  return (
    <CommandDialog
      title="Search"
      open={open}
      onOpenChange={onOpenChange}
      shouldFilter={false}
    >
      <CommandInput
        value={draft}
        onValueChange={onDraft}
        placeholder="Search…"
        className="text-[1rem] md:text-md"
      />
      <CommandList ref={listRef}>
        {draft.trim() ? (
          instant === "failed" ? (
            <ListNote>Search Is Unreachable</ListNote>
          ) : instant &&
            instant.direct.length + instant.related.length === 0 ? (
            <ListNote>No Direct Matches</ListNote>
          ) : (
            instant && (
              <>
                <CommandItem
                  value="__wall"
                  onSelect={() => onShowOnWall(draft)}
                >
                  <SearchIcon className="size-4 text-ink-muted" aria-hidden />
                  <span className="min-w-0 flex-1 truncate" dir="auto">
                    {draft}
                  </span>
                  <Kbd>↵</Kbd>
                </CommandItem>
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
                  <div key={s.id} className="flex min-w-0 items-center">
                    <CommandItem
                      value={`recent:${s.id}`}
                      className="min-w-0 flex-1"
                      onSelect={() => onShowOnWall(s.query)}
                    >
                      <span className="truncate" dir="auto" title={s.query}>
                        {s.query}
                      </span>
                    </CommandItem>
                    <button
                      type="button"
                      aria-label={`Delete Search ${s.query}`}
                      className="shrink-0 rounded-control px-2 py-1 text-xs text-ink-muted hover:text-ink"
                      onClick={() => void forget(s.id)}
                    >
                      Delete
                    </button>
                  </div>
                ))}
                <CommandItem
                  value="__clear_recent"
                  onSelect={() => void forget()}
                >
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
    </CommandDialog>
  );
}

/** A line in the ⌘K list where results would be. */
function ListNote({ children }: { children: string }) {
  return (
    <p role="status" className="py-6 text-center text-sm text-ink-muted">
      {children}
    </p>
  );
}

function ResultGroup({
  heading,
  memories,
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
