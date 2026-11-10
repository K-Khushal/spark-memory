import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { LogOutIcon, PlusIcon, SearchIcon } from "lucide-react";
import {
  Button,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Kbd,
  Toaster,
  toast,
} from "@spark/ui";
import { authClient, type Session } from "../auth";
import { MOD, useLibraryShortcuts } from "./shortcuts";

/**
 * The app shell: sidebar (a top bar on phones) beside the Library wall
 * (DESIGN.md → Pick). The wall is empty until Capture lands (#5).
 */
export function LibraryPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const openSearch = () => setSearchOpen(true);

  // Capture arrives with #5; until then the shortcut and buttons say so.
  const capture = () => toast("Capture is coming soon");
  useLibraryShortcuts({
    onSearch: openSearch,
    onToggleSearch: () => setSearchOpen((open) => !open),
    onPaste: capture,
  });

  const signOut = async () => {
    setSearchOpen(false);
    const { error } = await authClient.signOut().catch(() => ({ error: true }));
    if (error) {
      toast("Sign Out did not finish. Try again.");
      return;
    }
    await navigate({ to: "/sign-in" });
  };

  const searchButton = (
    <button
      type="button"
      onClick={openSearch}
      className="flex h-9 w-full min-w-0 items-center gap-2 rounded-control bg-surface px-2.5 text-left text-sm text-ink-muted shadow-raised transition-transform duration-[120ms] ease-out active:scale-[0.97]"
    >
      <SearchIcon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">Search</span>
      <Kbd className="hidden md:inline-flex">{MOD}K</Kbd>
    </button>
  );

  return (
    <div className="flex min-h-dvh bg-canvas">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-5 border-r border-line bg-sunken p-3 md:flex">
        <div className="flex h-8 items-center justify-between pl-2">
          <Wordmark />
          <Button
            variant="quiet"
            size="icon-sm"
            aria-label="Capture"
            onClick={capture}
          >
            <PlusIcon aria-hidden />
          </Button>
        </div>
        {searchButton}
        <nav aria-label="Library">
          <ul>
            <li>
              <Link
                to="/"
                aria-current="page"
                className="flex h-8 items-center rounded-control bg-surface px-2 text-sm font-medium text-ink shadow-raised"
              >
                All Memories
              </Link>
            </li>
          </ul>
        </nav>
        <div className="mt-auto flex items-center gap-1 pl-2">
          <span
            className="min-w-0 flex-1 truncate text-sm text-ink-muted"
            title={session.user.email}
          >
            {session.user.email}
          </span>
          <Button
            variant="quiet"
            size="icon-sm"
            aria-label="Sign Out"
            title="Sign Out"
            onClick={() => void signOut()}
          >
            <LogOutIcon aria-hidden />
          </Button>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-canvas px-4 py-2 md:hidden">
          <Wordmark />
          <div className="min-w-0 flex-1">{searchButton}</div>
          <Button
            variant="primary"
            size="icon"
            aria-label="Capture"
            onClick={capture}
          >
            <PlusIcon aria-hidden />
          </Button>
        </div>
        <h1 className="sr-only">Library</h1>
        <EmptyLibrary onCapture={capture} onSearch={openSearch} />
      </main>

      <CommandDialog
        title="Search"
        open={searchOpen}
        onOpenChange={setSearchOpen}
      >
        <CommandInput
          placeholder="Search…"
          className="text-[1rem] md:text-md"
        />
        <CommandList>
          <CommandEmpty>No Results</CommandEmpty>
          <CommandGroup>
            <Action icon={<PlusIcon />} hint={`${MOD}V`} onSelect={capture}>
              Capture
            </Action>
            <Action icon={<LogOutIcon />} onSelect={() => void signOut()}>
              Sign Out
            </Action>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
      <Toaster />
    </div>
  );
}

function Wordmark() {
  return <span className="font-display text-md font-semibold">Spark</span>;
}

/** Teaches the two shortcuts by being them: Capture (⌘V) and Search (⌘K). */
function EmptyLibrary({
  onCapture,
  onSearch,
}: {
  onCapture: () => void;
  onSearch: () => void;
}) {
  return (
    <div className="grid min-h-[calc(100dvh-3.5rem)] place-items-center p-4 md:min-h-dvh">
      <div className="flex flex-col items-center gap-5">
        <h2 className="font-display text-lg font-semibold">No Memories Yet</h2>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="primary" className="h-10" onClick={onCapture}>
            <PlusIcon aria-hidden /> Capture
            <Kbd className="hidden border-transparent bg-canvas/15 text-canvas sm:inline-flex">
              {MOD}V
            </Kbd>
          </Button>
          <Button variant="outline" className="h-10" onClick={onSearch}>
            <SearchIcon aria-hidden /> Search
            <Kbd className="hidden sm:inline-flex">{MOD}K</Kbd>
          </Button>
        </div>
      </div>
    </div>
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
