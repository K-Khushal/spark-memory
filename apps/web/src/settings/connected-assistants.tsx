import { useEffect, useState, type FormEvent } from "react";
import { Button, Input } from "@spark/ui";
import { api } from "../api";

const requestTimeout = () => ({
  init: { signal: AbortSignal.timeout(20_000) },
});

type Assistant = { id: string; name: string };
async function readAssistants() {
  const res = await api.api.assistants.$get({}, requestTimeout());
  if (!res.ok) throw new Error("assistants unavailable");
  return (await res.json()).assistants;
}
/** Credentials exist only in this mounted view, never browser storage or a URL. */
export function ConnectedAssistants() {
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [name, setName] = useState("");
  const [token, setToken] = useState<string>();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  async function load() {
    setAssistants(await readAssistants());
  }
  useEffect(() => {
    let active = true;
    void readAssistants().then(
      (rows) => {
        if (active) setAssistants(rows);
      },
      () => {
        if (active) setFailed(true);
      }
    );
    return () => {
      active = false;
    };
  }, []);
  async function create(event: FormEvent) {
    event.preventDefault();
    if (pending || !name.trim()) return;
    setPending(true);
    setFailed(false);
    setToken(undefined);
    try {
      const res = await api.api.assistants.$post(
        { json: { name } },
        requestTimeout()
      );
      if (!res.ok) throw new Error("assistant not created");
      setToken((await res.json()).token);
      setName("");
      await load();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }
  async function revoke(id: string) {
    setPending(true);
    setFailed(false);
    try {
      const res = await api.api.assistants[":id"].$delete(
        { param: { id } },
        requestTimeout()
      );
      if (!res.ok) throw new Error("assistant not revoked");
      setToken(undefined);
      await load();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="flex flex-col gap-4">
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
        <div className="flex gap-2">
          <Input
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
      {token && (
        <div className="flex flex-col gap-2">
          <label htmlFor="assistant-token">Copy Token Now</label>
          <Input
            id="assistant-token"
            name="assistant-token"
            autoComplete="off"
            spellCheck={false}
            value={token}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button variant="outline" onClick={() => setToken(undefined)}>
            Done
          </Button>
        </div>
      )}
      {failed && <p role="alert">Could Not Update Connected Assistants</p>}
    </div>
  );
}
