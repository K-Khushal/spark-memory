import { useRef, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ChevronDownIcon,
  LibraryIcon,
  LogOutIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  XIcon,
} from "lucide-react";
import { LayoutGroup, MotionConfig, motion } from "motion/react";
import {
  Button,
  cn,
  inputModality,
  Kbd,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  StateBlock,
  toast,
  useScrollFade,
} from "@spark/ui";
import { DURATION, EASING } from "@spark/ui/tokens";
import { authClient, endSession } from "./auth";
import { MOD, useLibraryShortcuts } from "./library/shortcuts";

/** A shared layout id: the current item's surface glides between items. */
const NAV_INDICATOR = "desk-nav-indicator";

/**
 * The raised surface behind the current sidebar item. It glides between items
 * in 180ms (DESIGN.md → Motion) when a pointer moved it, and jumps when the
 * keyboard did; reduced motion jumps too (MotionConfig on the sidebar).
 */
function NavIndicator() {
  const byPointer = inputModality() === "pointer";
  return (
    <motion.span
      layoutId={NAV_INDICATOR}
      aria-hidden
      className="absolute inset-0 rounded-control bg-surface shadow-raised"
      transition={
        byPointer
          ? { duration: DURATION.small / 1000, ease: EASING.out }
          : { duration: 0 }
      }
    />
  );
}

/** A sidebar destination. The current one is the raised surface. */
export function DeskNavLink({
  to,
  current,
  inPlace = false,
  onClick,
  children,
}: {
  to: "/" | "/admin" | "/settings";
  current: boolean;
  /**
   * The page is already on this route but narrowed by a filter: a button,
   * because the router marks a link to the active route as the current
   * page whatever it is told.
   */
  inPlace?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  const className = cn(
    "relative flex h-8 items-center gap-2 rounded-control px-2 text-sm transition-[color] duration-(--duration-press) ease-out pointer-coarse:min-h-(--size-touch) [&_svg]:size-4",
    current ? "font-medium text-ink" : "text-ink-muted hover:text-ink"
  );
  const content = (
    <>
      {current && <NavIndicator />}
      <span className="relative flex min-w-0 items-center gap-2">
        {children}
      </span>
    </>
  );
  return inPlace ? (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        className,
        "w-full text-left focus-visible:outline-2 focus-visible:outline-ring"
      )}
    >
      {content}
    </button>
  ) : (
    <Link
      to={to}
      aria-current={current ? "page" : undefined}
      onClick={onClick}
      className={className}
    >
      {content}
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
  imageControl,
}: {
  label: string;
  active?: boolean;
  onSearch: () => void;
  onClear?: () => void;
  imageControl?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "group/search flex min-h-9 min-w-0 items-center gap-2 rounded-control bg-surface shadow-raised pointer-coarse:min-h-(--size-touch)",
        ((imageControl && !active) || onClear) && "pr-1"
      )}
    >
      <button
        type="button"
        data-desk="search"
        onClick={onSearch}
        className="flex min-h-9 min-w-0 flex-1 items-center gap-2 self-stretch rounded-control pr-2 pl-2.5 text-left text-sm text-ink-muted transition-[transform,color] duration-(--duration-press) ease-out hover:text-ink active:scale-[0.97]"
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
      {/* While a search is active the field's text takes this slot; Search By Image stays in ⌘K. */}
      {imageControl && !active && (
        <div className="hidden shrink-0 group-focus-within/search:block">
          {imageControl}
        </div>
      )}
      {onClear && (
        <Button
          variant="quiet"
          size="icon-sm"
          aria-label="Clear Search"
          className="shrink-0"
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
  searchImageControl,
  onClearSearch,
  filters,
  filtered = false,
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
  /** ⌘V outside a field. Only the Library handles it. */
  onPaste?: (data: DataTransfer) => void;
  /** What Search shows: "Search", the query, or "More Like This". */
  searchLabel?: string;
  searchActive?: boolean;
  searchImageControl?: ReactNode;
  onClearSearch?: () => void;
  /** Filter chips under the navigation (the Library). */
  filters?: ReactNode;
  /** A filter narrows the Library, so All Memories is not what is showing. */
  filtered?: boolean;
}) {
  const filtersScroll = useRef<HTMLDivElement>(null);
  useScrollFade(filtersScroll);
  useLibraryShortcuts({
    onSearch,
    onToggleSearch: onToggleSearch ?? onSearch,
    onPaste,
    keepTyping: current !== "library",
  });

  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup id="desk-sidebar">
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-5 overflow-y-auto border-r border-line bg-sunken p-3 md:flex">
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
            imageControl={searchImageControl}
            onSearch={onSearch}
            onClear={onClearSearch}
          />
          <nav aria-label="Library">
            <ul className="flex flex-col gap-1">
              <li>
                <DeskNavLink
                  to="/"
                  current={current === "library" && !filtered}
                  inPlace={current === "library" && filtered}
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
          {/* Long lists scroll here; the person's own corner stays put. */}
          <div
            ref={filtersScroll}
            className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1"
          >
            {filters}
          </div>
          <div className="flex shrink-0 flex-col gap-1">
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
      </LayoutGroup>
    </MotionConfig>
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

/**
 * A whole-screen message with one way forward: the same empty and error state
 * on every screen. The Library's own h1 is out of sight, so it passes
 * `level={2}`. A state inside a page (a search's recovery next to its
 * results) uses `StateBlock` from @spark/ui directly, aligned to the start.
 */
export function Centred({
  title,
  level = 1,
  children,
}: {
  title: string;
  level?: 1 | 2;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-[calc(100dvh-3.5rem)] place-items-center p-4 md:min-h-dvh">
      <StateBlock title={title} level={level} align="centre" className="gap-5">
        {children}
      </StateBlock>
    </div>
  );
}

/**
 * The phone's wordmark as a menu (below md the sidebar is gone): Library and
 * Settings, and Admin for the owner. Mount it where the top bar's wordmark
 * stands, beside Search and Capture. A destination closes the menu and
 * navigates; the current one is marked. Hidden from md up.
 */
export function PhoneNavigation({
  current,
  admin,
  onLibrary,
}: {
  current: "library" | "admin" | "settings";
  admin: boolean;
  /** Choosing Library while on it (a filter may be on): clear what narrows it. */
  onLibrary?: () => void;
}) {
  const here = (page: typeof current) =>
    page === current ? ("page" as const) : undefined;
  return (
    <div className="md:hidden">
      <Menu modal={false}>
        <MenuTrigger asChild>
          <button
            type="button"
            aria-label="Spark Navigation"
            className="-ml-2 flex h-9 items-center gap-1 rounded-control px-2 font-display text-md font-semibold transition-[background-color,transform] duration-(--duration-press) ease-out hover:bg-sunken active:scale-[0.97] pointer-coarse:min-h-(--size-touch)"
          >
            Spark
            <ChevronDownIcon className="size-4 text-ink-muted" aria-hidden />
          </button>
        </MenuTrigger>
        <MenuContent aria-label="Navigation" aria-labelledby={undefined}>
          {current === "library" ? (
            <MenuItem aria-current="page" onSelect={() => onLibrary?.()}>
              <LibraryIcon aria-hidden /> Library
            </MenuItem>
          ) : (
            <MenuItem asChild>
              <Link to="/">
                <LibraryIcon aria-hidden /> Library
              </Link>
            </MenuItem>
          )}
          <MenuItem asChild>
            <Link to="/settings" aria-current={here("settings")}>
              <SettingsIcon aria-hidden /> Settings
            </Link>
          </MenuItem>
          {admin && (
            <MenuItem asChild>
              <Link to="/admin" aria-current={here("admin")}>
                <ShieldIcon aria-hidden /> Admin
              </Link>
            </MenuItem>
          )}
        </MenuContent>
      </Menu>
    </div>
  );
}

/**
 * The first Tab stop on a page: it jumps past the sidebar to the content
 * (WCAG 2.4.1). Out of sight until it has focus.
 */
export function SkipLink() {
  return (
    <a
      href="#content"
      onClick={(event) => {
        event.preventDefault();
        document.getElementById("content")?.focus();
      }}
      className="fixed top-2 left-2 z-50 -translate-y-[200%] rounded-control bg-ink px-3 py-2 text-sm font-medium text-canvas focus-visible:translate-y-0"
    >
      Skip To Content
    </a>
  );
}
