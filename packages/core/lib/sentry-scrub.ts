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

/** Memory file URLs: their paths name a person and a Memory, so only where they point is kept. */
const FILE_URL =
  /^(?:https?:\/\/)?([^/?#]*\.r2\.cloudflarestorage\.com)(?:[/?#]|$)|^(?:[a-z][a-z\d+.-]*:\/\/[^/?#]*)?(\/api\/local-files)\//i;

/** The path of a URL, without origin, query or fragment; a file URL's host or route only. */
function urlPath(url: string): string {
  const file = FILE_URL.exec(url);
  if (file) return file[1] ?? file[2]!;
  const withoutOrigin = url.replace(/^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i, "");
  return withoutOrigin.split(/[?#]/)[0] || "/";
}

// A custom error name can be built from content: keep it only if it looks like an identifier.
const EXCEPTION_TYPE = /^[A-Za-z_$][\w$.]{0,63}$/;

function scrubException(value: unknown): Fields {
  const { type: rawType, mechanism, stacktrace } = value as Fields;
  const frames = list((stacktrace as Fields | undefined)?.frames);
  const type =
    typeof rawType === "string" && EXCEPTION_TYPE.test(rawType)
      ? rawType
      : "Error";
  return {
    ...(rawType !== undefined && { type }),
    // The message can quote user content; the type is enough to group on.
    value: type,
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
  // contexts are dropped entirely: even runtime/os names can carry prose.

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
