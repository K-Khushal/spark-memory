import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import type { InferResponseType } from "@spark/api-client";
import { Button, Input, Toaster, cn, toast } from "@spark/ui";
import { api } from "../api";
import { startAnalytics } from "../analytics";
import {
  authClient,
  endSession,
  noteAdminStatus,
  type AppSession,
} from "../auth";
import { DeskSidebar, useLibraryDesk } from "../shell";
import {
  dollarsToMicros,
  formatBytes,
  formatCost,
  microsToDollars,
} from "./format";

type Summary = InferResponseType<(typeof api.api.admin.summary)["$get"], 200>;
type Usage = InferResponseType<(typeof api.api.admin.users)["$get"], 200>;

const PAGE = 50;

/** Costs, usage and the daily budget. One quiet page of tables. */
export function AdminPage({ session }: { session: AppSession }) {
  const navigate = useNavigate();
  const desk = useLibraryDesk();
  const [summary, setSummary] = useState<Summary>();
  const [usage, setUsage] = useState<Usage>();
  const [offset, setOffset] = useState(0);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const draftReady = useRef(false);

  useEffect(() => {
    startAnalytics(session.user.id);
  }, [session.user.id]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.api.admin.summary.$get(),
      api.api.admin.users.$get({
        query: { limit: String(PAGE), offset: String(offset) },
      }),
    ])
      .then(async ([summaryRes, usersRes]) => {
        if (cancelled) return;
        if (!summaryRes.ok || !usersRes.ok) {
          noteAdminStatus(summaryRes.status);
          noteAdminStatus(usersRes.status);
          setFailed(true);
          return;
        }
        const next = await summaryRes.json();
        setSummary(next);
        setUsage(await usersRes.json());
        if (!draftReady.current) {
          draftReady.current = true;
          setDraft(microsToDollars(next.budget.limitMicros));
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [offset, attempt]);

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

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const limitMicros = dollarsToMicros(draft);
    if (limitMicros === undefined) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    try {
      const res = await api.api.admin.budget.$put({ json: { limitMicros } });
      if (!res.ok) {
        noteAdminStatus(res.status);
        toast("Budget Did Not Save");
        return;
      }
      const { budget } = await res.json();
      setSummary((current) => current && { ...current, budget });
      setDraft(microsToDollars(budget.limitMicros));
    } catch {
      toast("Budget Did Not Save");
    }
  };

  return (
    <div className="flex min-h-dvh bg-canvas">
      <DeskSidebar
        email={session.user.email}
        current="admin"
        admin
        onSignOut={() => void signOut()}
        onCapture={desk.onCapture}
        onSearch={desk.onSearch}
      />
      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-canvas px-4 py-2 md:hidden">
          <span className="font-display text-md font-semibold">Spark</span>
          <Link to="/" className="text-sm text-ink-muted">
            All Memories
          </Link>
        </div>
        {failed ? (
          <div className="grid min-h-[calc(100dvh-3.5rem)] place-items-center p-4 md:min-h-dvh">
            <div className="flex flex-col items-center gap-4">
              <h1 className="font-display text-lg font-semibold">
                Admin Is Unreachable
              </h1>
              <Button
                variant="outline"
                onClick={() => {
                  setFailed(false);
                  setAttempt((n) => n + 1);
                }}
              >
                Try Again
              </Button>
            </div>
          </div>
        ) : summary && usage ? (
          <main className="mx-auto max-w-4xl px-4 py-6 md:px-8">
            <h1 className="font-display text-lg font-semibold">Admin</h1>
            <section className="mt-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="font-display text-md font-semibold">
                  Daily Budget
                </h2>
                <p className="mt-2 text-sm tabular-nums">
                  {formatCost(summary.budget.spentMicros)} /{" "}
                  {formatCost(summary.budget.limitMicros)}
                </p>
                <p
                  className={cn(
                    "text-sm",
                    summary.budget.paused ? "text-indexing" : "text-ink-muted"
                  )}
                >
                  {summary.budget.paused ? "Paused" : "Active"}
                </p>
              </div>
              <form
                onSubmit={(event) => void save(event)}
                className="flex items-center gap-2"
              >
                <div className="relative w-28">
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-ink-muted"
                  >
                    $
                  </span>
                  <Input
                    aria-label="Daily Budget"
                    inputMode="decimal"
                    autoComplete="off"
                    className="h-8 pl-6"
                    value={draft}
                    aria-invalid={invalid || undefined}
                    onChange={(event) => {
                      setDraft(event.target.value);
                      setInvalid(false);
                    }}
                  />
                </div>
                <Button type="submit" variant="primary" size="sm">
                  Save
                </Button>
              </form>
            </section>

            <section className="mt-8">
              <h2
                id="daily-spend"
                className="font-display text-md font-semibold"
              >
                Daily Spend
              </h2>
              <div className="mt-3 overflow-x-auto">
                <table
                  aria-labelledby="daily-spend"
                  className="w-full text-left text-sm"
                >
                  <thead className="text-ink-muted">
                    <tr className="border-b border-line">
                      <Column>Day</Column>
                      <Column>Provider</Column>
                      <Column>Model</Column>
                      <Column align="right">Calls</Column>
                      <Column align="right">Cost</Column>
                      <Column>Estimated</Column>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.spend.map((row) => (
                      <tr
                        key={`${row.day}-${row.provider}-${row.model}-${row.estimated}`}
                        className="border-b border-line"
                      >
                        <Cell className="tabular-nums">{row.day}</Cell>
                        <Cell>{row.provider}</Cell>
                        <Cell className="max-w-48 truncate">{row.model}</Cell>
                        <Cell align="right" className="tabular-nums">
                          {row.calls}
                        </Cell>
                        <Cell align="right" className="tabular-nums">
                          {formatCost(row.costMicros)}
                        </Cell>
                        <Cell>{row.estimated ? "Yes" : "No"}</Cell>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="mt-8">
              <h2 id="usage" className="font-display text-md font-semibold">
                Usage
              </h2>
              <div className="mt-3 overflow-x-auto">
                <table
                  aria-labelledby="usage"
                  className="w-full text-left text-sm"
                >
                  <thead className="text-ink-muted">
                    <tr className="border-b border-line">
                      <Column>Email</Column>
                      <Column align="right">Memories</Column>
                      <Column align="right">Storage</Column>
                      <Column align="right">Cost</Column>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.users.map((person) => (
                      <tr key={person.id} className="border-b border-line">
                        <Cell
                          className="max-w-64 truncate"
                          title={person.email}
                        >
                          {person.email}
                        </Cell>
                        <Cell align="right" className="tabular-nums">
                          {person.memories}
                        </Cell>
                        <Cell align="right" className="tabular-nums">
                          {formatBytes(person.storageBytes)}
                        </Cell>
                        <Cell align="right" className="tabular-nums">
                          {formatCost(person.costMicros)}
                        </Cell>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {usage.total > PAGE && (
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={offset === 0}
                    onClick={() => setOffset((n) => Math.max(0, n - PAGE))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={offset + usage.users.length >= usage.total}
                    onClick={() => setOffset((n) => n + PAGE)}
                  >
                    Next
                  </Button>
                </div>
              )}
            </section>
          </main>
        ) : null}
      </div>
      <Toaster />
    </div>
  );
}

function Column({
  children,
  align = "left",
}: {
  children: string;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={cn(
        "py-2 pr-4 font-medium whitespace-nowrap",
        align === "right" && "text-right"
      )}
    >
      {children}
    </th>
  );
}

function Cell({
  children,
  align = "left",
  className,
  title,
}: {
  children: string | number;
  align?: "left" | "right";
  className?: string;
  title?: string;
}) {
  return (
    <td
      title={title}
      className={cn(
        "py-2 pr-4 whitespace-nowrap",
        align === "right" && "text-right",
        className
      )}
    >
      {children}
    </td>
  );
}
