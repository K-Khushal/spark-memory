import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";
import { THEMES, RADIUS, TYPE_SCALE } from "@spark/ui/tokens";
import "@spark/ui/fonts.css";
import { API_ORIGIN } from "../../lib/config";
import type { SavedMemory } from "../../lib/client";
import "./style.css";

type State = { hasRows?: boolean } & (
  | { state: "saving" | "queued" | "signed-out" | "error"; label?: string }
  | { state: "saved" | "duplicate"; memory: SavedMemory; owner: string }
);
const labels = {
  saving: "Saving",
  saved: "Saved",
  duplicate: "Already in Your Library",
  queued: "Waiting to Send",
  "signed-out": "Sign In",
  error: "Try Again",
};
function Popup() {
  const [result, setResult] = useState<State>({ state: "saving" });
  const [note, setNote] = useState("");
  const [noteState, setNoteState] = useState("Add Capture Note");
  async function capture() {
    setResult({ state: "saving" });
    try {
      setResult(await browser.runtime.sendMessage({ type: "capture" }));
    } catch {
      setResult({ state: "error" });
    }
  }
  useEffect(() => {
    void browser.runtime
      .sendMessage({ type: "capture" })
      .then(setResult)
      .catch(() => setResult({ state: "error" }));
  }, []);
  const saved = result.state === "saved" || result.state === "duplicate";
  return (
    <main>
      <header>
        <a
          href={API_ORIGIN}
          target="_blank"
          rel="noreferrer"
          aria-label="Open Library"
        >
          Spark
        </a>
      </header>
      <h1 role="status">
        {("label" in result && result.label) || labels[result.state]}
      </h1>
      {result.state === "signed-out" && (
        <a
          className="button"
          href={`${API_ORIGIN}/sign-in`}
          target="_blank"
          rel="noreferrer"
        >
          Sign In
        </a>
      )}
      {(result.state === "error" ||
        result.state === "queued" ||
        result.state === "signed-out") && (
        <button
          onClick={
            result.state === "queued"
              ? async () =>
                  setResult(
                    await browser.runtime.sendMessage({ type: "retry" })
                  )
              : capture
          }
        >
          Try Again
        </button>
      )}
      {saved && (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setNoteState("Saving");
            const response = await browser.runtime
              .sendMessage({
                type: "note",
                owner: result.owner,
                memory: result.memory,
                note,
              })
              .catch(() => ({ error: true }));
            if (response.error) setNoteState("Try Again");
            else {
              setResult({ ...result, memory: response.memory });
              setNoteState("Saved");
            }
          }}
        >
          <label htmlFor="note">Capture Note</label>
          <textarea
            id="note"
            name="captureNote"
            dir="auto"
            maxLength={500}
            rows={3}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setNoteState("Add Capture Note");
            }}
          />
          <button disabled={!note.trim() || noteState === "Saving"}>
            {noteState}
          </button>
        </form>
      )}
      {result.hasRows && result.state !== "saving" && (
        <button
          onClick={async () => {
            if (!window.confirm("Discard All Queued Captures?")) return;
            await browser.runtime.sendMessage({ type: "clear" });
            window.close();
          }}
        >
          Discard Outbox
        </button>
      )}
    </main>
  );
}
const dark = matchMedia("(prefers-color-scheme: dark)").matches;
for (const [key, value] of Object.entries(THEMES[dark ? "dark" : "light"]))
  document.documentElement.style.setProperty(`--${key}`, value);
document.documentElement.style.setProperty("--radius", `${RADIUS.control}px`);
document.documentElement.style.setProperty(
  "--font-size",
  `${TYPE_SCALE.sm.size}px`
);
document.documentElement.style.setProperty(
  "--leading",
  `${TYPE_SCALE.sm.leading}px`
);
createRoot(document.getElementById("root")!).render(<Popup />);
