import { Link, useNavigate } from "@tanstack/react-router";
import { LogOutIcon, SettingsIcon } from "lucide-react";
import { Button, cn, toast } from "@spark/ui";
import { authClient } from "./auth";

// What every signed-in screen's sidebar shares (DESIGN.md → Pick).

export function Wordmark() {
  return <span className="font-display text-md font-semibold">Spark</span>;
}

/** A sidebar item; the current one is raised. */
export function SidebarLink({
  to,
  current,
  onClick,
  children,
}: {
  to: "/" | "/settings";
  current: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      aria-current={current ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "flex h-8 items-center gap-2 rounded-control px-2 text-sm transition-colors duration-[120ms] ease-out [&_svg]:size-4",
        current
          ? "bg-surface font-medium text-ink shadow-raised"
          : "text-ink-muted hover:text-ink"
      )}
    >
      {children}
    </Link>
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
    await navigate({ to: "/sign-in" });
  };
  return signOut;
}

/** The bottom of the sidebar: Settings, then who is signed in with Sign Out. */
export function SidebarFooter({
  email,
  current,
  onSignOut,
}: {
  email: string;
  current?: "settings";
  onSignOut: () => void;
}) {
  return (
    <div className="mt-auto flex flex-col gap-1">
      <SidebarLink to="/settings" current={current === "settings"}>
        <SettingsIcon aria-hidden /> Settings
      </SidebarLink>
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
  );
}
