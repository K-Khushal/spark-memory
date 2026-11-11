import type { ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { LogOutIcon, SettingsIcon } from "lucide-react";
import { Button, cn, toast } from "@spark/ui";
import { authClient, endSession } from "./auth";

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
  current: "library" | "admin" | "settings";
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
