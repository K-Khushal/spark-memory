import { useEffect, useRef, useState } from "react";
import { motion, MotionConfig } from "motion/react";
import { DURATION, EASING } from "@spark/ui/tokens";
import { Button, Kbd, toast } from "@spark/ui";
import { api } from "../api";
import { track } from "../analytics";
import type { Activation } from "./activation";
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
  onActivated,
  memories,
  refresh,
  onCapture,
  onSearch,
  onOpen,
}: {
  activationVersion: number;
  /** The first successful search is already recorded. */
  onActivated: () => void;
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
  const [extensionAvailable] = useState(
    () =>
      !window.matchMedia?.("(pointer: coarse)").matches &&
      /Chrome|Chromium|Firefox/.test(navigator.userAgent) &&
      !/Android|Mobile/.test(navigator.userAgent)
  );
  const passedExtension = useRef(false);
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
  const activated = !!state?.firstSuccessfulSearchAt;
  useEffect(() => {
    if (activated) onActivated();
  }, [activated, onActivated]);
  useEffect(() => {
    if (state?.step === "capture" && !state.paused && first && !pending.current)
      void update("indexing");
    // first.id changes only when the Library gains a Capture; server progress
    // survives a reload between Capture and Indexing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.step, state?.paused, first?.id]);

  useEffect(() => {
    if (
      state?.step === "extension" &&
      !state.paused &&
      !extensionAvailable &&
      !passedExtension.current
    ) {
      passedExtension.current = true;
      void update("capture");
    }
    // The server owns progress; only pass this step once per mounted flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.step, state?.paused, extensionAvailable]);
  const steps = extensionAvailable
    ? ["disclosure", "extension", "capture", "indexing", "search"]
    : ["disclosure", "capture", "indexing", "search"];
  const stepIndex =
    state?.step === "done"
      ? steps.length - 1
      : Math.max(0, steps.indexOf(state?.step ?? "disclosure"));
  if (!state && !failed) return null;
  const finished = state?.step === "done" && state.paused;
  // Finished, with Samples left: only the one action that removes them.
  if (finished && !sampleCount) return null;
  return (
    <section
      aria-label="Get Started"
      className={`@container px-4 md:px-6 ${state?.step === "disclosure" && !memories.length ? "flex min-h-[50dvh] items-center justify-center" : "border-b border-line"}`}
    >
      <MotionConfig reducedMotion="user">
        {failed && !state ? (
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-medium">Get Started Is Unreachable</h2>
            <Button
              wrap
              variant="outline"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Try Again
            </Button>
          </div>
        ) : (
          state && (
            <div
              className={`flex w-full flex-col justify-center gap-3 ${state.step === "disclosure" ? "max-w-xl py-6" : `max-w-3xl sm:flex-row sm:items-center ${finished ? "min-h-12" : "min-h-26 py-3 sm:min-h-16"}`}`}
            >
              <div
                className={`flex min-w-0 flex-wrap items-center ${state.step === "disclosure" ? "gap-3" : "gap-2"}`}
              >
                {!finished && (
                  <div
                    role="group"
                    className="flex shrink-0 gap-1"
                    aria-label={`Step ${stepIndex + 1} of ${steps.length}`}
                  >
                    {steps.map((step, index) => (
                      <span
                        key={step}
                        className={`h-1 w-4 transition-colors duration-(--duration-press) ease-(--ease-out) motion-reduce:transition-none ${index <= stepIndex ? "bg-ink" : "bg-line"}`}
                      />
                    ))}
                  </div>
                )}
                <h2
                  className={
                    finished
                      ? "sr-only"
                      : state.step === "disclosure"
                        ? "font-display text-xl font-semibold"
                        : "text-base font-medium"
                  }
                >
                  {state.paused
                    ? "Get Started"
                    : state.step === "indexing" &&
                        first?.indexState === "searchable"
                      ? "Searchable"
                      : headings[state.step]}
                </h2>
              </div>
              {state.paused && !finished && (
                <Button
                  wrap
                  variant="outline"
                  disabled={busy}
                  onClick={() => void update(state.step)}
                >
                  Resume
                </Button>
              )}
              {!state.paused && (
                <motion.div
                  key={state.step}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{
                    duration: DURATION.preview / 1000,
                    ease: EASING.out,
                  }}
                  className={`flex min-w-0 ${state.step === "disclosure" ? "flex-col items-start gap-3" : "items-center flex-nowrap gap-2"}`}
                  aria-busy={busy}
                >
                  {state.step === "disclosure" && (
                    <>
                      <p className="min-w-0 flex-1 text-sm @max-[12rem]:basis-full">
                        AI reads your Memories to make them Searchable, unless
                        you turn on AI Opt-Out for a Memory.
                      </p>
                      <Button
                        wrap
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
                      <Button wrap variant="outline" asChild>
                        <a
                          href="https://github.com/K-Khushal/spark-memory/blob/main/docs/extension.md"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Install Extension
                        </a>
                      </Button>
                      <Button
                        wrap
                        variant="primary"
                        disabled={busy}
                        onClick={() => void update("capture")}
                      >
                        Next
                      </Button>
                    </>
                  )}
                  {state.step === "capture" && (
                    <Button wrap variant="primary" onClick={onCapture}>
                      Capture <Kbd>{MOD}V</Kbd>
                    </Button>
                  )}
                  {state.step === "indexing" && (
                    <>
                      {first?.indexState !== "searchable" && (
                        <span role="status" className="text-sm">
                          {first?.indexState === "failed"
                            ? "Failed"
                            : "Indexing"}
                        </span>
                      )}
                      {first?.indexState !== "searchable" &&
                        (first ? (
                          <Button
                            wrap
                            variant="outline"
                            onClick={() => onOpen(first)}
                          >
                            Open Memory
                          </Button>
                        ) : (
                          <Button
                            wrap
                            variant="outline"
                            onClick={() => void update("capture")}
                          >
                            Capture Again
                          </Button>
                        ))}
                      {first && first.indexState !== "indexing" && (
                        <Button
                          wrap
                          variant="primary"
                          disabled={busy}
                          onClick={() => void update("search")}
                        >
                          Try Search
                        </Button>
                      )}
                    </>
                  )}
                  {state.step === "search" && (
                    <Button
                      wrap
                      variant="primary"
                      onClick={() =>
                        onSearch(sampleCount ? "bookshop with a cat" : "")
                      }
                    >
                      Try a Vague Search <Kbd>{MOD}K</Kbd>
                    </Button>
                  )}
                  {state.step === "done" && (
                    <Button
                      wrap
                      variant="outline"
                      disabled={busy}
                      onClick={() => void update("done", true)}
                    >
                      Finish
                    </Button>
                  )}
                  {finished ? null : state.paused ? (
                    <Button
                      wrap
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
                        wrap
                        variant="quiet"
                        disabled={busy}
                        onClick={() => void update(state.step, true)}
                      >
                        Skip
                      </Button>
                    )
                  )}
                </motion.div>
              )}
              <div>
                {sampleCount > 0 && (finished || state.step === "done") && (
                  <Button
                    wrap
                    variant="quiet"
                    disabled={busy}
                    onClick={() =>
                      void mutate(() => endpoint.samples.$delete(), true)
                    }
                  >
                    Remove Samples
                  </Button>
                )}
              </div>
            </div>
          )
        )}
      </MotionConfig>
    </section>
  );
}

/** The server wins concurrent tabs; event properties contain no query. */
export async function recordActivation(memoryId: string): Promise<Activation> {
  try {
    const res = await endpoint.activation.$post({ json: { memoryId } });
    if (!res.ok) return "failed";
    const { recorded } = await res.json();
    if (!recorded) return "unchanged";
    track({ event: "first_successful_search", properties: {} });
    return "recorded";
  } catch {
    return "failed";
  }
}
