import { FREE_ALLOWANCE, type VideoMetadata } from "@spark/core";
import { publicFetch, type Resolve } from "./public-fetch";

type ObjectValue = Record<string, unknown>;
const object = (v: unknown): ObjectValue =>
  v !== null && typeof v === "object" ? (v as ObjectValue) : {};

/** Reads just the public player JSON, without executing any page script. */
function player(html: string): ObjectValue {
  const marker = /(?:var\s+)?ytInitialPlayerResponse\s*=\s*/g.exec(html);
  if (!marker) return {};
  const start = marker.index + marker[0].length;
  let depth = 0,
    quoted = false,
    escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return object(JSON.parse(html.slice(start, i + 1)));
      } catch {
        return {};
      }
    }
  }
  return {};
}

/** Captions exposed by a public page only. No cookies, login or private API. */
export async function publicVideo(
  html: string,
  options: {
    fetch: typeof fetch;
    resolve: Resolve;
    permitted: () => Promise<boolean>;
  }
): Promise<VideoMetadata> {
  const data = player(html);
  const duration = Number(object(data.videoDetails).lengthSeconds);
  const known = Number.isFinite(duration) && duration > 0;
  const video: VideoMetadata = {
    ...(known && { duration }),
    transcript: [],
    transcriptState:
      known && duration > FREE_ALLOWANCE.videoTranscriptMaxMinutes * 60
        ? "over_allowance"
        : "unavailable",
  };
  if (!known || video.transcriptState === "over_allowance") return video;
  const tracks = object(
    object(data.captions).playerCaptionsTracklistRenderer
  ).captionTracks;
  if (!Array.isArray(tracks)) return video;
  const track =
    tracks.find((t) => object(t).languageCode === "en") ?? tracks[0];
  const base = object(track).baseUrl;
  if (typeof base !== "string") return video;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return video;
  }
  if (
    url.origin !== "https://www.youtube.com" ||
    url.pathname !== "/api/timedtext" ||
    url.username ||
    url.password
  )
    return video;
  url.searchParams.set("fmt", "json3");
  const response = await publicFetch(url.href, {
    ...options,
    accept: ["application/json", "text/json"],
    maxBytes: 1_000_000,
  });
  if (!response.ok || response.truncated) return video;
  try {
    const events = object(JSON.parse(response.text)).events;
    if (!Array.isArray(events) || events.length > 10000) return video;
    let chars = 0,
      previous = -1;
    for (const event of events) {
      const e = object(event);
      const seconds = typeof e.tStartMs === "number" ? e.tStartMs / 1000 : NaN;
      if (
        !Number.isFinite(seconds) ||
        seconds < previous ||
        seconds < 0 ||
        seconds > duration ||
        !Array.isArray(e.segs)
      )
        continue;
      const text = e.segs
        .map((s) => object(s).utf8)
        .filter((s): s is string => typeof s === "string")
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      if (!text) continue;
      chars += text.length + 1;
      // Never silently keep a partial transcript and label it complete.
      if (chars > FREE_ALLOWANCE.textMaxChars)
        return { ...video, transcript: [] };
      video.transcript.push({ seconds, text });
      previous = seconds;
    }
    if (video.transcript.length) video.transcriptState = "available";
  } catch {
    /* No public transcript: metadata remains searchable. */
  }
  return video;
}
