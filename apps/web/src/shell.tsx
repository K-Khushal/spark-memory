import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { LogOutIcon } from "lucide-react";
import { Button, cn } from "@spark/ui";

/** A sidebar destination. The current one is the raised surface. */
export function DeskNavLink({
  to,
  current,
  onClick,
  children,
}: {
  to: "/" | "/admin";
  current: boolean;
  onClick?: () => void;
  children: string;
}) {
  return (
    <Link
      to={to}
      aria-current={current ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "flex h-8 items-center rounded-control px-2 text-sm transition-[color] duration-[120ms] ease-out",
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
 * The desk sidebar (DESIGN.md → Pick): wordmark, the page's own tools,
 * Library navigation, and the person. Hidden below md; each page draws its
 * own phone bar.
 */
export function DeskSidebar({
  email,
  current,
  admin,
  onSignOut,
  onLibrary,
  headerAction,
  children,
}: {
  email: string;
  current: "library" | "admin";
  admin: boolean;
  onSignOut: () => void;
  onLibrary?: () => void;
  headerAction?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-5 border-r border-line bg-sunken p-3 md:flex">
      <div className="flex h-8 items-center justify-between pl-2">
        <span className="font-display text-md font-semibold">Spark</span>
        {headerAction}
      </div>
      {children}
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
      <div className="mt-auto flex items-center gap-1 pl-2">
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
    </aside>
  );
}
