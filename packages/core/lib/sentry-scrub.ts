// Allowlist scrubbing for Sentry events. Anything not listed here is dropped,
// because any free-text field (message, exception value, contexts, breadcrumb
// text, URLs with queries) can carry Memory content. Typed structurally so
// this package needs no Sentry dependency.

type Fields = Record<string, unknown>;

const EVENT_FIELDS = [
  "event_id",
  "timestamp",
  "start_timestamp",
  "type",
  "level",
  "platform",
  "environment",
  "release",
  "sdk",
] as const;
const FRAME_FIELDS = ["filename", "function", "lineno", "colno", "in_app"];
const BREADCRUMB_FIELDS = ["type", "category", "level", "timestamp"];
const KEPT_CONTEXTS = ["runtime", "os"];

function pick(source: unknown, keys: readonly string[]): Fields {
  const out: Fields = {};
  if (typeof source !== "object" || source === null) return out;
  for (const key of keys) {
    const value = (source as Fields)[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** The path of a URL, without origin, query or fragment. */
function urlPath(url: string): string {
  const withoutOrigin = url.replace(/^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i, "");
  return withoutOrigin.split(/[?#]/)[0] || "/";
}

function scrubException(value: unknown): Fields {
  const { type, mechanism, stacktrace } = value as Fields;
  const frames = list((stacktrace as Fields | undefined)?.frames);
  return {
    ...(type !== undefined && { type }),
    // The message can quote user content; the type is enough to group on.
    value: typeof type === "string" ? type : "Error",
    ...(mechanism !== undefined && {
      mechanism: pick(mechanism, ["type", "handled"]),
    }),
    ...(frames.length > 0 && {
      stacktrace: { frames: frames.map((f) => pick(f, FRAME_FIELDS)) },
    }),
  };
}

export function scrubBreadcrumb<T extends object>(breadcrumb: T): T {
  return pick(breadcrumb, BREADCRUMB_FIELDS) as T;
}

export function scrubEvent<T extends object>(event: T): T {
  const source = event as Fields;
  const out = pick(source, EVENT_FIELDS);
  if (source.message !== undefined) out.message = "[redacted]";

  const exceptions = list((source.exception as Fields | undefined)?.values);
  if (exceptions.length > 0) {
    out.exception = { values: exceptions.map(scrubException) };
  }
  if (source.tags !== undefined) out.tags = source.tags;

  const contexts = source.contexts as Fields | undefined;
  if (contexts) {
    const kept: Fields = {};
    for (const name of KEPT_CONTEXTS) {
      if (contexts[name])
        kept[name] = pick(contexts[name], ["name", "version"]);
    }
    if (Object.keys(kept).length > 0) out.contexts = kept;
  }

  const request = source.request as Fields | undefined;
  if (request) {
    out.request = {
      ...(typeof request.method === "string" && { method: request.method }),
      ...(typeof request.url === "string" && { url: urlPath(request.url) }),
    };
  }

  const breadcrumbs = list(source.breadcrumbs);
  if (breadcrumbs.length > 0) {
    out.breadcrumbs = breadcrumbs.map((b) => scrubBreadcrumb(b as object));
  }
  return out as T;
}
