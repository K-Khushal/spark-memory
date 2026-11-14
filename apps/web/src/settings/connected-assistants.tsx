import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Dialog, DialogContent, DialogTitle, Input } from "@spark/ui";
import { api } from "../api";
import { ActivityDialog } from "./assistant-activity";
import { ConnectionGuide } from "./connection-guide";

const requestTimeout = () => ({
  init: { signal: AbortSignal.timeout(20_000) },
});
type Assistant = { id: string; name: string; lastActiveAt: string | null };
const day = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
});

/** "Today", "Yesterday" or a date; never-used assistants say so. */
function lastActive(at: string | null) {
  if (!at) return "Not Used Yet";
  const days = Math.round(
    (new Date().setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) /
      86_400_000
  );
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return day.format(new Date(at));
}
type AssistantState =
  | { phase: "idle" | "pending" }
  | { phase: "failed"; message?: string }
  | { phase: "issued"; token: string };
async function readAssistants() {
  const res = await api.api.assistants.$get({}, requestTimeout());
  if (!res.ok) throw new Error("assistants unavailable");
  return (await res.json()).assistants;
}

/** Credentials exist only in the issued state, never browser storage or a URL. */
export function ConnectedAssistants() {
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [name, setName] = useState("");
  const [state, setState] = useState<AssistantState>({ phase: "pending" });
  const [confirming, setConfirming] = useState<Assistant>();
  const [viewing, setViewing] = useState<Assistant>();
  const [guide, setGuide] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const guideButton = useRef<HTMLButtonElement>(null);
  const pending = state.phase === "pending";
  useEffect(() => {
    let active = true;
    void readAssistants().then(
      (rows) => {
        if (active) {
          setAssistants(rows);
          setState({ phase: "idle" });
        }
      },
      () => {
        if (active) setState({ phase: "failed" });
      }
    );
    return () => {
      active = false;
    };
  }, []);
  async function create(event: FormEvent) {
    event.preventDefault();
    if (pending || !name.trim()) return;
    setState({ phase: "pending" });
    try {
      const res = await api.api.assistants.$post(
        { json: { name } },
        requestTimeout()
      );
      if (res.status === 409) {
        setState({
          phase: "failed",
          message: "Token Limit Reached",
        });
        return;
      }
      if (!res.ok) throw new Error("assistant not created");
      const created = await res.json();
      setAssistants((all) => [
        ...all,
        { id: created.id, name: created.name, lastActiveAt: null },
      ]);
      setName("");
      setState({ phase: "issued", token: created.token });
    } catch {
      setState({ phase: "failed" });
    }
  }
  async function revoke(target: Assistant) {
    if (pending) return;
    setState({ phase: "pending" });
    try {
      const res = await api.api.assistants[":id"].$delete(
        { param: { id: target.id } },
        requestTimeout()
      );
      if (!res.ok && res.status !== 404)
        throw new Error("assistant not revoked");
      const index = assistants.findIndex((a) => a.id === target.id);
      setAssistants((all) => all.filter((a) => a.id !== target.id));
      setState({ phase: "idle" });
      setConfirming(undefined);
      // Focus stays in the list: the next assistant's Activity, else the guide.
      requestAnimationFrame(() => {
        const left = [...(list.current?.querySelectorAll("li") ?? [])];
        const next = left[index === left.length ? index - 1 : index];
        (
          next?.querySelector<HTMLElement>("button") ?? guideButton.current
        )?.focus();
      });
    } catch {
      setConfirming(undefined);
      setState({ phase: "failed", message: "Could Not Revoke" });
    }
  }
  async function retry() {
    setState({ phase: "pending" });
    try {
      setAssistants(await readAssistants());
      setState({ phase: "idle" });
    } catch {
      setState({ phase: "failed" });
    }
  }
  return (
    <div className="flex flex-col gap-4" aria-busy={pending}>
      {assistants.length > 0 ? (
        <ul
          ref={list}
          aria-label="Connected Assistants"
          className="flex flex-col"
        >
          {assistants.map((a) => (
            <li
              key={a.id}
              className="flex min-h-14 min-w-0 items-center gap-2 border-b border-line py-1 last:border-b-0"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm" dir="auto">
                  {a.name}
                </span>
                <span className="text-xs text-ink-muted tabular">
                  {lastActive(a.lastActiveAt)}
                </span>
              </div>
              <Button
                variant="quiet"
                size="sm"
                aria-label={`Activity of ${a.name}`}
                onClick={() => setViewing(a)}
              >
                Activity
              </Button>
              <Button
                variant="quiet"
                size="sm"
                className="-mr-3"
                disabled={pending}
                aria-label={`Revoke ${a.name}`}
                onClick={() => setConfirming(a)}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        state.phase !== "pending" && (
          <p className="text-sm text-ink-muted">No Connected Assistants</p>
        )
      )}
      <div>
        <Button
          ref={guideButton}
          variant="outline"
          onClick={() => setGuide(true)}
        >
          Connection Guide
        </Button>
      </div>
      <form onSubmit={(e) => void create(e)} className="flex flex-col gap-2">
        <label htmlFor="assistant-name" className="text-sm text-ink-muted">
          Assistant Name
        </label>
        <div className="flex flex-wrap gap-2">
          <Input
            className="flex-1 basis-40"
            id="assistant-name"
            name="assistant-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
            autoComplete="off"
          />
          <Button type="submit" variant="outline" disabled={pending}>
            Create Token
          </Button>
        </div>
      </form>
      {state.phase === "issued" && (
        <div className="flex flex-col gap-2">
          <label htmlFor="assistant-token" className="text-sm text-ink-muted">
            Copy Token Now
          </label>
          <Input
            id="assistant-token"
            name="assistant-token"
            autoComplete="off"
            spellCheck={false}
            value={state.token}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button variant="outline" onClick={() => setState({ phase: "idle" })}>
            Done
          </Button>
        </div>
      )}
      {state.phase === "failed" && (
        <div className="flex flex-col gap-2">
          <p role="alert">
            {state.message ?? "Could Not Update Connected Assistants"}
          </p>
          <Button variant="outline" onClick={() => void retry()}>
            Try Again
          </Button>
        </div>
      )}
      <ConnectionGuide open={guide} onOpenChange={setGuide} />
      {viewing && (
        <ActivityDialog
          assistant={viewing}
          onClose={() => setViewing(undefined)}
        />
      )}
      <Dialog
        open={!!confirming}
        onOpenChange={(open) => open || pending || setConfirming(undefined)}
      >
        <DialogContent className="max-w-md p-6" aria-describedby={undefined}>
          <div className="flex flex-col gap-5">
            <DialogTitle className="pr-8 wrap-anywhere" dir="auto">
              Revoke {confirming?.name}
            </DialogTitle>
            <div className="flex justify-end gap-2">
              <Button
                variant="quiet"
                disabled={pending}
                onClick={() => setConfirming(undefined)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={pending}
                onClick={() => confirming && void revoke(confirming)}
              >
                Revoke
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
