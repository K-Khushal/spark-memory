export type Flight<T> = {
  promise: Promise<T>;
  controller: AbortController;
  /** Askers still waiting on it. */
  askers: number;
};

/**
 * One request in the air per `key`, shared by everyone who asks for it
 * meanwhile (the ⌘K menu and the wall asking again for the same failed
 * search): it is sent once and both get the answer. Each asker has its own
 * `signal`; the request is only cancelled when the last one lets go. Once
 * it settles it is forgotten, so a failure is never reused.
 */
export function sharedFlight<T>(
  flights: Map<string, Flight<T>>,
  key: string,
  start: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal
): Promise<T> {
  let flight = flights.get(key);
  if (!flight) {
    const controller = new AbortController();
    const created: Flight<T> = {
      promise: start(controller.signal),
      controller,
      askers: 0,
    };
    const forget = () => {
      if (flights.get(key) === created) flights.delete(key);
    };
    created.promise.then(forget, forget);
    flights.set(key, created);
    flight = created;
  }
  const joined = flight;
  joined.askers++;
  return new Promise<T>((resolve, reject) => {
    const leave = () => {
      if (--joined.askers === 0) {
        joined.controller.abort();
        if (flights.get(key) === joined) flights.delete(key);
      }
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal.aborted) return leave();
    signal.addEventListener("abort", leave, { once: true });
    const settled = () => signal.removeEventListener("abort", leave);
    joined.promise.then(
      (value) => {
        settled();
        resolve(value);
      },
      (error: unknown) => {
        settled();
        reject(error);
      }
    );
  });
}
