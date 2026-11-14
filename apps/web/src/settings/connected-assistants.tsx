import { useEffect, useState, type FormEvent } from "react";
import { Button, Input } from "@spark/ui";
import { api } from "../api";

const requestTimeout = () => ({
  init: { signal: AbortSignal.timeout(20_000) },
});
type Assistant = { id: string; name: string };
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
      setAssistants((all) => [...all, { id: created.id, name: created.name }]);
      setName("");
      setState({ phase: "issued", token: created.token });
    } catch {
      setState({ phase: "failed" });
    }
  }
  async function revoke(id: string) {
    if (pending) return;
    setState({ phase: "pending" });
    try {
      const res = await api.api.assistants[":id"].$delete(
        { param: { id } },
        requestTimeout()
      );
      if (!res.ok && res.status !== 404)
        throw new Error("assistant not revoked");
      setAssistants((all) => all.filter((a) => a.id !== id));
      setState({ phase: "idle" });
    } catch {
      setState({ phase: "failed" });
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
      {assistants.map((a) => (
        <div
          key={a.id}
          className="flex min-w-0 items-center justify-between gap-3"
        >
          <span className="min-w-0 wrap-anywhere" dir="auto">
            {a.name}
          </span>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => void revoke(a.id)}
            aria-label={`Revoke ${a.name}`}
          >
            Revoke
          </Button>
        </div>
      ))}
      <form onSubmit={(e) => void create(e)} className="flex flex-col gap-2">
        <label htmlFor="assistant-name">Assistant Name</label>
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
          <label htmlFor="assistant-token">Copy Token Now</label>
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
    </div>
  );
}
