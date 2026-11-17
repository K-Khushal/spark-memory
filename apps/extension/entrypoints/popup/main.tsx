import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CrossfadeIcon } from "@spark/ui";
import { browser } from "wxt/browser";
import "../../lib/theme";
import "@spark/ui/fonts.css";
import { API_ORIGIN } from "../../lib/config";
import type { SavedMemory } from "../../lib/client";
import "./style.css";

type State = { hasRows?: boolean } & (
  | { state: "saving" | "queued" | "signed-out" | "error"; label?: string }
  | { state: "saved" | "duplicate"; memory: SavedMemory; owner: string }
);
const labels = {
  saving: "Capturing",
  saved: "Captured",
  duplicate: "Already in Your Library",
  queued: "Waiting to Send",
  "signed-out": "Sign In",
  error: "Try Again",
};
function Popup() {
  const [result, setResult] = useState<State>({ state: "saving" });
  const [note, setNote] = useState("");
  const [noteState, setNoteState] = useState("Add Note");
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
        <a href={API_ORIGIN} target="_blank" rel="noreferrer">
          Spark<span className="sr-only">, Open Library</span>
        </a>
      </header>
      <p
        role="status"
        className={result.state === "signed-out" ? "sr-only" : undefined}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
          className={result.state === "saving" ? "spinner" : undefined}
        >
          {saved ? (
            <path d="m5 12 4 4L19 6" />
          ) : result.state === "queued" ? (
            <>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 6v6l4 2" />
            </>
          ) : (
            <path d="M21 12a9 9 0 1 1-3-6.7M21 3v6h-6" />
          )}
        </svg>
        {("label" in result && result.label) || labels[result.state]}
      </p>
      {saved && result.memory.title && (
        <a
          className="memory-title"
          href={`${API_ORIGIN}/?memory=${encodeURIComponent(result.memory.id)}`}
          target="_blank"
          rel="noreferrer"
        >
          {result.memory.title}
        </a>
      )}
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
      {(result.state === "error" || result.state === "queued") && (
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
            setNoteState("Adding");
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
              setResult({
                ...result,
                memory: {
                  ...response.memory,
                  title: response.memory.title ?? result.memory.title,
                },
              });
              setNoteState("Note Added");
            }
          }}
        >
          <label htmlFor="capture-note">Capture Note</label>
          <textarea
            id="capture-note"
            name="captureNote"
            dir="auto"
            maxLength={500}
            rows={3}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setNoteState("Add Note");
            }}
          />
          <button disabled={!note.trim() || noteState === "Adding"}>
            <CrossfadeIcon
              on={noteState === "Note Added"}
              from={
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
              }
              to={
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="m5 12 4 4L19 6" />
                </svg>
              }
            />
            {noteState}
          </button>
        </form>
      )}
      {result.hasRows && result.state !== "saving" && (
        <button
          className="quiet"
          onClick={async () => {
            if (!window.confirm("Discard All Queued Captures?")) return;
            await browser.runtime.sendMessage({ type: "clear" });
            window.close();
          }}
        >
          Discard Captures
        </button>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Popup />);
