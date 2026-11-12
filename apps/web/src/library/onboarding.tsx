import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { DURATION, EASING } from "@spark/ui/tokens";
import { Button, Kbd, toast } from "@spark/ui";
import { api } from "../api";
import { track } from "../analytics";
import { MOD } from "./shortcuts";
import type { Memory } from "./use-library";

const endpoint = api.api.onboarding;
type State = Awaited<
  ReturnType<Awaited<ReturnType<typeof endpoint.$get>>["json"]>
>;
type Step = State["step"];
const headings: Record<Step, string> = {
  disclosure: "Get Started",
  extension: "Install the Extension",
  capture: "Capture a Memory",
  indexing: "Watch Indexing",
  search: "Find a Memory",
  done: "Ready",
};

/** One server state, one pending mutation. Failures leave the last state intact. */
export function Onboarding({
  activationVersion,
  memories,
  refresh,
  onCapture,
  onSearch,
  onOpen,
}: {
  activationVersion: number;
  memories: Memory[];
  refresh: () => void;
  onCapture: () => void;
  onSearch: (query: string) => void;
  onOpen: (memory: Memory) => void;
}) {
  const [state, setState] = useState<State>();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const pending = useRef(false);
  const sampleCount = memories.filter((m) => m.sample).length;
  const first = memories.find((m) => !m.sample);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      endpoint
        .$get()
        .then(async (res) => {
          if (!res.ok) throw new Error("unavailable");
          const next = await res.json();
          if (!cancelled) {
            setState(next);
            setFailed(false);
          }
        })
        .catch(() => !cancelled && setFailed(true));
    void load();
    const visible = () => {
      if (document.visibilityState === "visible" && !pending.current)
        void load();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", visible);
    };
  }, [activationVersion, attempt]);
  async function mutate(
    request: () => Promise<Response>,
    reloadLibrary = false
  ) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const res = await request();
      if (!res.ok) throw new Error("unavailable");
      if (res.status !== 204) {
        const next = (await res.json()) as State;
        setState(next);
      }
      if (reloadLibrary) refresh();
    } catch {
      toast("Get Started Did Not Update", {
        action: {
          label: "Try Again",
          onClick: () => void mutate(request, reloadLibrary),
        },
      });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const update = (step: Step, paused = false) =>
    mutate(() => endpoint.$put({ json: { step, paused } }));
  useEffect(() => {
    if (state?.step === "capture" && !state.paused && first && !pending.current)
      void update("indexing");
    // first.id changes only when the Library gains a Capture; server progress
    // survives a reload between Capture and Indexing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.step, state?.paused, first?.id]);

  if (!state && !failed) return null;
  const finished = state?.step === "done" && state.paused;
  // Finished, with examples left: only the one action that removes them.
  if (finished && !sampleCount) return null;
  return (
    <section
      aria-label="Get Started"
      className="border-b border-line px-4 py-5 md:px-6"
    >
      {failed && !state ? (
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-medium">Get Started Is Unreachable</h2>
          <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>
            Try Again
          </Button>
        </div>
      ) : (
        state && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2
                className={
                  finished ? "sr-only" : "font-display text-lg font-semibold"
                }
              >
                {state.paused ? "Get Started" : headings[state.step]}
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                {sampleCount > 0 && (
                  <Button
                    variant="quiet"
                    disabled={busy}
                    onClick={() =>
                      void mutate(() => endpoint.samples.$delete(), true)
                    }
                  >
                    Remove Samples
                  </Button>
                )}
                {finished ? null : state.paused ? (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void update(state.step)}
                  >
                    Resume
                  </Button>
                ) : (
                  // The AI disclosure is the one step that is not skippable.
                  state.step !== "done" &&
                  state.step !== "disclosure" && (
                    <Button
                      variant="quiet"
                      disabled={busy}
                      onClick={() => void update(state.step, true)}
                    >
                      Skip
                    </Button>
                  )
                )}
              </div>
            </div>
            {!state.paused && (
              <motion.div
                key={state.step}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{
                  duration: DURATION.small / 1000,
                  ease: EASING.out,
                }}
                className="mt-4 flex min-w-0 flex-wrap items-center gap-3"
                aria-busy={busy}
              >
                {state.step === "disclosure" && (
                  <>
                    <p className="max-w-prose text-sm">
                      Saved content is processed by AI; turn on AI Opt-Out for a
                      Memory to keep it from AI.
                    </p>
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() =>
                        void mutate(() => endpoint.start.$post(), true)
                      }
                    >
                      Continue
                    </Button>
                  </>
                )}
                {state.step === "extension" && (
                  <>
                    <a
                      className="rounded-control border border-line-strong px-3 py-2 text-sm font-medium underline-offset-4 hover:underline"
                      href="https://github.com/K-Khushal/spark-memory/blob/main/docs/extension.md"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Install Extension
                    </a>
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() => void update("capture")}
                    >
                      Next
                    </Button>
                  </>
                )}
                {state.step === "capture" && (
                  <Button variant="primary" onClick={onCapture}>
                    Capture <Kbd>{MOD}V</Kbd>
                  </Button>
                )}
                {state.step === "indexing" && (
                  <>
                    <span role="status" className="text-sm">
                      {first?.indexState === "searchable"
                        ? "Searchable"
                        : first?.indexState === "failed"
                          ? "Failed"
                          : "Indexing"}
                    </span>
                    {first ? (
                      <Button variant="outline" onClick={() => onOpen(first)}>
                        Open Memory
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        onClick={() => void update("capture")}
                      >
                        Capture Again
                      </Button>
                    )}
                    <Button
                      variant="primary"
                      disabled={busy || first?.indexState !== "searchable"}
                      onClick={() => void update("search")}
                    >
                      Try Search
                    </Button>
                  </>
                )}
                {state.step === "search" && (
                  <Button
                    variant="primary"
                    onClick={() =>
                      onSearch(
                        sampleCount
                          ? "that little place with books and a cat"
                          : ""
                      )
                    }
                  >
                    Try a Vague Search <Kbd>{MOD}K</Kbd>
                  </Button>
                )}
                {state.step === "done" && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void update("done", true)}
                  >
                    Finish
                  </Button>
                )}
              </motion.div>
            )}
          </>
        )
      )}
    </section>
  );
}

/** The server wins concurrent tabs; event properties contain no query. */
export async function recordActivation(memoryId: string) {
  try {
    const res = await endpoint.activation.$post({ json: { memoryId } });
    if (!res.ok) return false;
    const { recorded } = await res.json();
    if (recorded) track({ event: "first_successful_search", properties: {} });
    return true;
  } catch {
    return false;
  }
}
