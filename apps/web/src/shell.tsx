import type { ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  LogOutIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  XIcon,
} from "lucide-react";
import { Button, cn, Kbd, toast } from "@spark/ui";
import { authClient, endSession } from "./auth";
import { MOD, useLibraryShortcuts } from "./library/shortcuts";

/** A sidebar destination. The current one is the raised surface. */
export function DeskNavLink({
  to,
  current,
  onClick,
  children,
}: {
  to: "/" | "/admin" | "/settings";
  current: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      aria-current={current ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "flex h-8 items-center gap-2 rounded-control px-2 text-sm transition-[color] duration-(--duration-press) ease-out [&_svg]:size-4",
        current
          ? "bg-surface font-medium text-ink shadow-raised"
          : "text-ink-muted hover:text-ink"
      )}
    >
      {children}
    </Link>
  );
}

/**
 * Search as the desk draws it (DESIGN.md → Pick): the same control on every
 * page, so All Memories sits at one height. The Library passes the live query.
 */
export function DeskSearchField({
  label,
  active,
  onSearch,
  onClear,
}: {
  label: string;
  active?: boolean;
  onSearch: () => void;
  onClear?: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <button
        type="button"
        data-desk="search"
        onClick={onSearch}
        className="flex h-9 w-full min-w-0 items-center gap-2 rounded-control bg-surface px-2.5 text-left text-sm text-ink-muted shadow-raised transition-[transform,color] duration-(--duration-press) ease-out hover:text-ink active:scale-[0.97]"
      >
        <SearchIcon className="size-4 shrink-0" aria-hidden />
        <span
          className={cn("min-w-0 flex-1 truncate", active && "text-ink")}
          dir="auto"
        >
          {label}
        </span>
        {!active && <Kbd className="hidden md:inline-flex">{MOD}K</Kbd>}
      </button>
      {onClear && (
        <Button
          variant="quiet"
          size="icon-sm"
          aria-label="Clear Search"
          onClick={onClear}
        >
          <XIcon aria-hidden />
        </Button>
      )}
    </div>
  );
}

/**
 * The desk sidebar (DESIGN.md → Pick): wordmark, Capture, Search, Library
 * navigation, and the person. Capture and Search are always in the head, so
 * All Memories lines up on every page. Hidden below md; each page draws its
 * own phone bar.
 */
export function DeskSidebar({
  email,
  current,
  admin,
  onSignOut,
  onLibrary,
  onCapture,
  onSearch,
  onToggleSearch,
  onPaste,
  searchLabel = "Search",
  searchActive = false,
  onClearSearch,
}: {
  email: string;
  current: "library" | "admin" | "settings";
  admin: boolean;
  onSignOut: () => void;
  onLibrary?: () => void;
  onCapture: () => void;
  onSearch: () => void;
  /** ⌘K. Defaults to opening Search; the Library passes its toggle. */
  onToggleSearch?: () => void;
  /** ⌘V outside a field. Defaults to opening Capture. */
  onPaste?: (data: DataTransfer) => void;
  /** What Search shows: "Search", the query, or "More Like This". */
  searchLabel?: string;
  searchActive?: boolean;
  onClearSearch?: () => void;
}) {
  useLibraryShortcuts({
    onSearch,
    onToggleSearch: onToggleSearch ?? onSearch,
    onPaste: (data) => {
      if (onPaste) onPaste(data);
      else onCapture();
    },
  });

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-5 border-r border-line bg-sunken p-3 md:flex">
      <div className="flex h-8 items-center justify-between pl-2">
        <span className="font-display text-md font-semibold">Spark</span>
        <Button
          variant="quiet"
          size="icon-sm"
          aria-label="Capture"
          data-desk="capture"
          onClick={onCapture}
        >
          <PlusIcon aria-hidden />
        </Button>
      </div>
      <DeskSearchField
        label={searchLabel}
        active={searchActive}
        onSearch={onSearch}
        onClear={onClearSearch}
      />
      <nav aria-label="Library">
        <ul className="flex flex-col gap-1">
          <li>
            <DeskNavLink
              to="/"
              current={current === "library"}
              onClick={onLibrary}
            >
              All Memories
            </DeskNavLink>
          </li>
          {admin && (
            <li>
              <DeskNavLink to="/admin" current={current === "admin"}>
                Admin
              </DeskNavLink>
            </li>
          )}
        </ul>
      </nav>
      <div className="mt-auto flex flex-col gap-1">
        <DeskNavLink to="/settings" current={current === "settings"}>
          <SettingsIcon aria-hidden /> Settings
        </DeskNavLink>
        <div className="flex items-center gap-1 pl-2">
          <span
            className="min-w-0 flex-1 truncate text-sm text-ink-muted"
            title={email}
          >
            {email}
          </span>
          <Button
            variant="quiet"
            size="icon-sm"
            aria-label="Sign Out"
            title="Sign Out"
            onClick={onSignOut}
          >
            <LogOutIcon aria-hidden />
          </Button>
        </div>
      </div>
    </aside>
  );
}

/** The visible Capture or Search control, after a desk shortcut closes. */
export function focusDeskControl(which: "capture" | "search") {
  const nodes = document.querySelectorAll<HTMLElement>(
    `[data-desk="${which}"]`
  );
  const visible = [...nodes].find((node) => node.getClientRects().length > 0);
  (visible ?? nodes[0])?.focus();
}

/** Capture and Search from a desk page other than the Library: open them there. */
export function useLibraryDesk() {
  const navigate = useNavigate();
  const open = (desk: "capture" | "search") =>
    void navigate({ to: "/", search: { desk } });
  return {
    onCapture: () => open("capture"),
    onSearch: () => open("search"),
  };
}

/** Signs out here and goes to sign-in; a failure says so with Try Again. */
export function useSignOut() {
  const navigate = useNavigate();
  const signOut = async () => {
    const { error } = await authClient.signOut().catch(() => ({ error: true }));
    if (error) {
      toast("Sign Out Did Not Finish", {
        action: { label: "Try Again", onClick: () => void signOut() },
      });
      return;
    }
    endSession();
    await navigate({ to: "/sign-in" });
  };
  return signOut;
}
