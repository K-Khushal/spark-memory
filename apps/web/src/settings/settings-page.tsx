import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, DownloadIcon, LoaderIcon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Input,
  Toaster,
} from "@spark/ui";
import type { Session } from "../auth";
import { SidebarFooter, SidebarLink, Wordmark, useSignOut } from "../shell";
import {
  useAccount,
  type DeviceSession,
  type LibraryExport,
} from "./use-account";

/** Settings: signed-in devices, Library export, account deletion. */
export function SettingsPage({ session }: { session: Session }) {
  const signOut = useSignOut();
  const account = useAccount();
  const { email } = session.user;

  return (
    <div className="flex min-h-dvh bg-canvas">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-5 border-r border-line bg-sunken p-3 md:flex">
        <div className="flex h-8 items-center pl-2">
          <Wordmark />
        </div>
        <nav aria-label="Library">
          <SidebarLink to="/" current={false}>
            All Memories
          </SidebarLink>
        </nav>
        <SidebarFooter
          email={email}
          current="settings"
          onSignOut={() => void signOut()}
        />
      </aside>

      <main className="min-w-0 flex-1">
        <div className="sticky top-0 z-20 flex h-[53px] items-center gap-2 border-b border-line bg-canvas px-4 md:hidden">
          <Button variant="quiet" size="icon" aria-label="Library" asChild>
            <Link to="/">
              <ArrowLeftIcon aria-hidden />
            </Link>
          </Button>
          <span aria-hidden className="font-display text-md font-semibold">
            Settings
          </span>
        </div>
        <div className="mx-auto flex max-w-xl flex-col gap-10 px-4 py-8 md:px-6 md:py-12">
          <h1 className="sr-only font-display text-xl font-semibold tracking-[-0.02em] md:not-sr-only">
            Settings
          </h1>
          <Section title="Sessions">
            <Sessions account={account} />
          </Section>
          <Section title="Export">
            <Export account={account} />
          </Section>
          <Section title="Account">
            <DeleteAccount email={email} account={account} />
          </Section>
        </div>
      </main>
      <Toaster />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={title} className="flex flex-col gap-3">
      <h2 id={title} className="text-sm font-medium text-ink-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

type Account = ReturnType<typeof useAccount>;

const day = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
});
const dayAndTime = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

/** "Today", "Yesterday" or a date, for when a device was last active. */
function lastActive(at: string) {
  const days = Math.floor(
    (new Date().setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) /
      86_400_000
  );
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return day.format(new Date(at));
}

function Sessions({ account }: { account: Account }) {
  const navigate = useNavigate();
  const { sessions } = account;
  const everywhere = async () => {
    if (await account.signOutEverywhere()) await navigate({ to: "/sign-in" });
  };
  if (sessions === "failed") return <Unreachable onRetry={account.reload} />;
  return (
    <>
      <ul aria-label="Sessions" className="flex flex-col">
        {sessions?.map((s) => (
          <SessionRow
            key={s.handle}
            session={s}
            onRevoke={() => void account.revoke(s)}
          />
        ))}
      </ul>
      <div>
        <Button variant="outline" onClick={() => void everywhere()}>
          Sign Out Everywhere
        </Button>
      </div>
    </>
  );
}

function SessionRow({
  session,
  onRevoke,
}: {
  session: DeviceSession;
  onRevoke: () => void;
}) {
  return (
    <li className="flex min-h-12 items-center gap-3 border-b border-line py-1 last:border-b-0">
      <span className="min-w-0 flex-1 truncate text-sm">{session.device}</span>
      {session.current ? (
        <span className="text-sm text-ink-muted">This Device</span>
      ) : (
        <>
          <span className="text-sm text-ink-muted tabular">
            {lastActive(session.lastActiveAt)}
          </span>
          <Button
            variant="quiet"
            size="sm"
            aria-label={`Sign Out ${session.device}`}
            onClick={onRevoke}
          >
            Sign Out
          </Button>
        </>
      )}
    </li>
  );
}

function Export({ account }: { account: Account }) {
  const current: LibraryExport | undefined | "failed" = account.export;
  if (current === "failed") return <Unreachable onRetry={account.reload} />;
  if (current === undefined) return <div className="h-9" />;
  if (current?.state === "building") {
    return (
      <div>
        <Button variant="outline" disabled>
          <LoaderIcon className="animate-spin" aria-hidden /> Exporting
        </Button>
      </div>
    );
  }
  if (current?.state === "ready") {
    return (
      <div className="flex items-center gap-3">
        <Button variant="primary" asChild>
          <a href={current.url} download>
            <DownloadIcon aria-hidden /> Download
          </a>
        </Button>
        <span className="text-sm text-ink-muted tabular">
          Until {dayAndTime.format(new Date(current.expiresAt))}
        </span>
      </div>
    );
  }
  return (
    <div>
      <Button variant="outline" onClick={() => void account.startExport()}>
        {current?.state === "failed" ? "Try Export Again" : "Export Library"}
      </Button>
    </div>
  );
}

function DeleteAccount({
  email,
  account,
}: {
  email: string;
  account: Account;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const field = useId();
  const matches = typed.trim().toLowerCase() === email.toLowerCase();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!matches || pending) return;
    setPending(true);
    const deleted = await account.deleteAccount(typed);
    setPending(false);
    if (deleted) await navigate({ to: "/sign-in" });
  };

  return (
    <>
      <div>
        <Button variant="outline" onClick={() => setOpen(true)}>
          Delete Account
        </Button>
      </div>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setTyped("");
        }}
      >
        <DialogContent className="max-w-md p-6" aria-describedby={undefined}>
          <form
            onSubmit={(e) => void submit(e)}
            className="flex flex-col gap-5"
          >
            <DialogTitle className="pr-8">
              Delete Your Account and Every Memory
            </DialogTitle>
            <div className="flex flex-col gap-2">
              <label htmlFor={field} className="text-sm text-ink-muted">
                Type <span className="break-all text-ink">{email}</span>
              </label>
              <Input
                id={field}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="quiet"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={!matches || pending}
              >
                {pending && <LoaderIcon className="animate-spin" aria-hidden />}
                Delete Account
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Unreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-ink-muted">Spark Is Unreachable</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try Again
      </Button>
    </div>
  );
}
