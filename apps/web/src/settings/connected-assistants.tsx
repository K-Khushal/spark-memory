import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CrossfadeIcon,
  Button,
  Dialog,
  DialogContent,
  DialogBody,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  Input,
} from "@spark/ui";
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
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const [connecting, setConnecting] = useState(false);
  const [guide, setGuide] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const activityButton = useRef<HTMLButtonElement>(null);
  const revokeButton = useRef<HTMLButtonElement>(null);
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
      setCopied(false);
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
  const feedback = (
    <>
      {state.phase === "failed" && (
        <div className="flex flex-col gap-2">
          <p role="alert">
            {state.message ?? "Could Not Update Connected Assistants"}
          </p>
          <Button wrap variant="outline" onClick={() => void retry()}>
            Try Again
          </Button>
        </div>
      )}
    </>
  );
  return (
    <div className="flex flex-col" aria-busy={pending}>
      {assistants.length > 0 ? (
        <ul
          ref={list}
          aria-label="Connected Assistants"
          className="flex flex-col"
        >
          {assistants.map((a) => (
            <li
              key={a.id}
              className="flex min-h-12 min-w-0 flex-wrap items-center gap-2 border-b border-line py-1 last:border-b-0"
            >
              <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
                <span className="wrap-anywhere text-sm" dir="auto">
                  {a.name}
                </span>
                <span className="text-xs text-ink-muted tabular">
                  {lastActive(a.lastActiveAt)}
                </span>
              </div>
              <Button
                wrap
                variant="quiet"
                size="sm"
                aria-label={`Activity of ${a.name}`}
                onClick={(event) => {
                  activityButton.current = event.currentTarget;
                  setViewing(a);
                }}
              >
                Activity
              </Button>
              <Button
                wrap
                variant="danger"
                size="sm"
                className="md:-mr-3"
                disabled={pending}
                aria-label={`Revoke ${a.name}`}
                onClick={(event) => {
                  revokeButton.current = event.currentTarget;
                  setConfirming(a);
                }}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        state.phase !== "pending" && (
          <p className="flex min-h-12 items-center text-sm text-ink-muted">
            No Connected Assistants
          </p>
        )
      )}
      <div className="flex min-h-12 flex-wrap items-center gap-3">
        <Button size="sm" variant="primary" onClick={() => setConnecting(true)}>
          Connect Assistant
        </Button>
        <Button
          wrap
          ref={guideButton}
          size="sm"
          variant="quiet"
          onClick={() => setGuide(true)}
        >
          Connection Guide
        </Button>
      </div>
      <Dialog
        open={connecting}
        onOpenChange={(open) => {
          if (!pending) {
            setConnecting(open);
            if (!open && state.phase === "issued") setState({ phase: "idle" });
          }
        }}
      >
        <DialogContent
          presentation="sheet"
          aria-describedby={undefined}
          className="flex max-h-[92dvh] max-w-md flex-col overflow-hidden"
        >
          <DialogHeader>
            <DialogTitle>Connect Assistant</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <form
              onSubmit={(e) => void create(e)}
              className="flex flex-col gap-2"
            >
              <label
                htmlFor="assistant-name"
                className="text-sm text-ink-muted"
              >
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
                <Button wrap type="submit" variant="outline" disabled={pending}>
                  Create Token
                </Button>
              </div>
            </form>
            {state.phase === "issued" && (
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="assistant-token"
                  className="text-sm text-ink-muted"
                >
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
                <Button
                  wrap
                  variant="outline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(state.token);
                      setCopied(true);
                    } catch {
                      document.getElementById("assistant-token")?.focus();
                    }
                  }}
                >
                  <CrossfadeIcon
                    on={copied}
                    from={<CopyIcon />}
                    to={<CheckIcon />}
                  />
                  {copied ? "Copied" : "Copy Token"}
                </Button>
                <span role="status" className="sr-only">
                  {copied ? "Copied" : ""}
                </span>
                <Button
                  wrap
                  variant="outline"
                  onClick={() => {
                    setState({ phase: "idle" });
                    setConnecting(false);
                  }}
                >
                  Done
                </Button>
              </div>
            )}
            {feedback}
          </DialogBody>
        </DialogContent>
      </Dialog>
      {!connecting && feedback}
      <ConnectionGuide
        open={guide}
        onOpenChange={setGuide}
        onReturnFocus={() => guideButton.current?.focus()}
      />
      {viewing && (
        <ActivityDialog
          assistant={viewing}
          onReturnFocus={() => activityButton.current?.focus()}
          onClose={() => setViewing(undefined)}
        />
      )}
      <Dialog
        open={!!confirming}
        onOpenChange={(open) => open || pending || setConfirming(undefined)}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (revokeButton.current?.isConnected) revokeButton.current.focus();
          }}
          presentation="sheet"
          className="flex max-h-[calc(100dvh-2rem)] max-w-md flex-col overflow-hidden"
          aria-describedby={undefined}
        >
          <div className="flex min-h-0 flex-col">
            <DialogBody className="p-0 sm:px-0">
              <DialogHeader>
                <DialogTitle className="wrap-anywhere" dir="auto">
                  Revoke {confirming?.name} Access
                </DialogTitle>
              </DialogHeader>
            </DialogBody>
            <DialogFooter>
              <Button
                wrap
                variant="quiet"
                disabled={pending}
                onClick={() => setConfirming(undefined)}
              >
                Cancel
              </Button>
              <Button
                wrap
                variant="primary"
                disabled={pending}
                onClick={() => confirming && void revoke(confirming)}
              >
                Revoke
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
