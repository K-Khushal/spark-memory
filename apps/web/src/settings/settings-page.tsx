import { ImportSection } from "./import-section";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
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
import { confirmsDeletion } from "@spark/core";
import type { Session } from "../auth";
import { UsageSection } from "./usage";
import { DeskSidebar, useLibraryDesk, useSignOut } from "../shell";
import {
  EXPORT_DOWNLOAD_URL,
  useAccount,
  type DeviceSession,
} from "./use-account";

/** Settings: signed-in devices, Library export, account deletion. */
export function SettingsPage({
  session,
  admin,
}: {
  session: Session;
  admin: boolean;
}) {
  const signOut = useSignOut();
  const desk = useLibraryDesk();
  const account = useAccount();
  const { email } = session.user;
  const { usage } = account;
  const loading =
    account.sessions === undefined ||
    account.export === undefined ||
    usage === undefined;
  const failed =
    account.sessions === "failed" ||
    account.export === "failed" ||
    usage === "failed";

  return (
    <div className="flex min-h-dvh bg-canvas">
      <DeskSidebar
        email={email}
        current="settings"
        admin={admin}
        onSignOut={() => void signOut()}
        onCapture={desk.onCapture}
        onSearch={desk.onSearch}
      />

      <main className="min-w-0 flex-1">
        <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-canvas px-4 py-2 md:hidden">
          <Button variant="quiet" size="icon" aria-label="Library" asChild>
            <Link to="/">
              <ArrowLeftIcon aria-hidden />
            </Link>
          </Button>
          <span aria-hidden className="font-display text-md font-semibold">
            Settings
          </span>
        </div>
        <div className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-6 md:px-6 md:py-12">
          <h1 className="sr-only font-display text-xl font-semibold tracking-[-0.02em] md:not-sr-only">
            Settings
          </h1>
          {/* Nothing until both have loaded, so nothing moves under the pointer. */}
          {failed ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-ink-muted">
                Spark Is Unreachable
              </span>
              <Button variant="outline" size="sm" onClick={account.reload}>
                Try Again
              </Button>
            </div>
          ) : loading ? null : (
            <>
              <Section title="Usage">
                <UsageSection usage={usage} onDelete={account.deleteMemory} />
              </Section>
              <Section title="Sessions">
                <Sessions account={account} />
              </Section>
              <Section title="Import">
                <ImportSection userId={session.user.id} />
              </Section>
              <Section title="Export" live>
                <Export account={account} />
              </Section>
              <Section title="Account">
                <DeleteAccount email={email} account={account} />
              </Section>
            </>
          )}
        </div>
      </main>
      <Toaster />
    </div>
  );
}

function Section({
  title,
  live,
  children,
}: {
  title: string;
  /** Announce changes (an export starting, finishing or failing). */
  live?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-sm font-medium text-ink-muted">
        {title}
      </h2>
      <div
        aria-live={live ? "polite" : undefined}
        className="flex flex-col gap-2"
      >
        {children}
      </div>
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

const until = (at: string) => dayAndTime.format(new Date(at));

/** Whether the time `at` (ISO) has come; re-renders when it does. */
function useReached(at: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  const due = at ? new Date(at).getTime() : undefined;
  useEffect(() => {
    if (due === undefined || due <= now) return;
    // At most a day ahead (setTimeout's limit is about 24.8 days).
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(due - now, 86_400_000)
    );
    return () => clearTimeout(timer);
  }, [due, now]);
  return due !== undefined && due <= now;
}

/** "Today", "Yesterday" or a date, for when a device was last active. */
function lastActive(at: string) {
  const days = Math.round(
    (new Date().setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) /
      86_400_000
  );
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return day.format(new Date(at));
}

function Spinner() {
  return (
    <LoaderIcon
      className="animate-spin motion-reduce:animate-none"
      aria-hidden
    />
  );
}

function Sessions({ account }: { account: Account }) {
  const navigate = useNavigate();
  const list = useRef<HTMLUListElement>(null);
  const sessions = Array.isArray(account.sessions) ? account.sessions : [];

  const buttons = () => [...(list.current?.querySelectorAll("button") ?? [])];
  const revoke = async (session: DeviceSession) => {
    const index = buttons().findIndex((b) => b === document.activeElement);
    if (!(await account.revoke(session))) return;
    // Focus stays in the list: the next device's Sign Out, else the last one.
    requestAnimationFrame(() => {
      if (index < 0) return;
      const left = buttons();
      (left[Math.min(index, left.length - 1)] ?? list.current)?.focus();
    });
  };
  const everywhere = async () => {
    if (await account.signOutEverywhere()) await navigate({ to: "/sign-in" });
  };

  return (
    <>
      <ul
        ref={list}
        aria-label="Sessions"
        tabIndex={-1}
        className="flex flex-col outline-none"
      >
        {sessions.map((s) => (
          <SessionRow
            key={s.handle}
            session={s}
            onRevoke={() => void revoke(s)}
          />
        ))}
      </ul>
      {/* With this device alone it would only repeat the sidebar's Sign Out. */}
      {sessions.length > 1 && (
        <div className="pt-1">
          <Button
            variant="outline"
            aria-disabled={account.pending === "everywhere"}
            onClick={() =>
              account.pending === "everywhere" || void everywhere()
            }
          >
            {account.pending === "everywhere" && <Spinner />}
            Sign Out Everywhere
          </Button>
        </div>
      )}
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
  const active = lastActive(session.lastActiveAt);
  return (
    <li className="flex min-h-12 items-center gap-3 border-b border-line py-1 last:border-b-0">
      <span className="min-w-0 flex-1 truncate text-sm">{session.device}</span>
      {session.current ? (
        <span className="text-sm text-ink-muted">This Device</span>
      ) : (
        <>
          <span className="text-sm text-ink-muted tabular">{active}</span>
          <Button
            variant="quiet"
            size="sm"
            className="-mr-3"
            aria-label={`Sign Out ${session.device}, ${active}`}
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
  const box = useRef<HTMLDivElement>(null);
  const current = account.export === "failed" ? null : account.export;
  const state = account.pending === "export" ? "building" : current?.state;
  const ready = current?.state === "ready" ? current : undefined;
  // A ready export can be replaced once the hourly cooldown has passed.
  const canExportAgain = useReached(ready?.nextExportAt);

  // The button changes under the keyboard: keep focus on what replaced it.
  const hadFocus = useRef(false);
  useEffect(() => {
    if (hadFocus.current)
      box.current?.querySelector<HTMLElement>("a, button")?.focus();
  }, [state]);

  return (
    <div
      ref={box}
      className="flex items-center gap-3"
      onFocus={() => (hadFocus.current = true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          hadFocus.current = false;
        }
      }}
    >
      {ready && state === "ready" && (
        <Button variant="primary" asChild>
          {/* When it expires is in its accessible name, not a caption. */}
          <a
            href={EXPORT_DOWNLOAD_URL}
            aria-label={`Download, Until ${until(ready.expiresAt)}`}
          >
            <DownloadIcon aria-hidden /> Download
          </a>
        </Button>
      )}
      {(state !== "ready" || canExportAgain) && (
        <Button
          variant="outline"
          aria-disabled={state === "building"}
          onClick={() => state === "building" || void account.startExport()}
        >
          {state === "building" ? (
            <>
              <Spinner /> Exporting
            </>
          ) : state === "failed" ? (
            "Try Export Again"
          ) : (
            "Export Library"
          )}
        </Button>
      )}
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
  const matches = confirmsDeletion(typed, email);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!matches || pending) return;
    setPending(true);
    const deleted = await account.deleteAccount(typed);
    if (deleted) {
      await navigate({ to: "/sign-in" });
      return;
    }
    setPending(false);
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
          // Once confirmed, it finishes: no closing halfway.
          if (pending) return;
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
                Type <span className="wrap-anywhere text-ink">{email}</span>
              </label>
              <Input
                id={field}
                name="email"
                type="text"
                inputMode="email"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="quiet"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                className="min-w-36"
                disabled={!matches || pending}
              >
                {pending && <Spinner />}
                <span className={pending ? "sr-only" : undefined}>
                  Delete Account
                </span>
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
