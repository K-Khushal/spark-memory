/** Fixed facts about Instagram's own web app, which the page calls itself. */
export const REEL_READ = {
  /** The public id every instagram.com page sends as `x-ig-app-id`. */
  appId: "936619743392459",
} as const;

export type ReelRead =
  | {
      ok: true;
      /** `data:video/mp4;base64,…` */
      video: string;
      bytes: number;
      duration: number;
      frames: {
        seconds: number;
        /** `data:image/jpeg;base64,…` */
        data: string;
        bytes: number;
        width: number;
        height: number;
      }[];
    }
  | { ok: false; reason: string };

/**
 * Reads a reel the way the person's own browser can (ADR-0010): Instagram's
 * page API with their session, the video from Instagram's media host without
 * it, a few frames drawn from it. Spark's servers never log in and never see
 * a cookie. Fails soft: any problem is `ok: false` and the Capture stays
 * Reference only.
 *
 * Injected into the page with `scripting.executeScript({ func })`, so it is
 * serialised: it must use nothing outside itself, and `limits` come as arguments.
 */
export async function readReel(
  code: string,
  limits: {
    maxBytes: number;
    maxFrames: number;
    frameMaxBytes: number;
    maxSeconds: number;
  }
): Promise<ReelRead> {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const fail = (reason: string): ReelRead => ({ ok: false, reason });
  // The tab may have moved on since the Capture: never ask another site.
  if (location.origin !== "https://www.instagram.com") return fail("origin");
  let id = BigInt(0);
  for (const letter of code) {
    const place = alphabet.indexOf(letter);
    if (place < 0) return fail("code");
    id = id * BigInt(64) + BigInt(place);
  }
  const dataUrl = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("read"));
      reader.readAsDataURL(blob);
    });
  const once = (target: HTMLVideoElement, name: string, ms: number) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(name)), ms);
      target.addEventListener(name, () => {
        clearTimeout(timer);
        resolve();
      });
    });

  let versions: { url: string; width: number }[];
  try {
    const info = await fetch(`/api/v1/media/${id}/info/`, {
      credentials: "include",
      headers: {
        "x-ig-app-id": "936619743392459",
        "x-requested-with": "XMLHttpRequest",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!info.ok) return fail("info");
    const body = (await info.json()) as {
      items?: { video_versions?: { url?: unknown; width?: unknown }[] }[];
    };
    versions = (body.items?.[0]?.video_versions ?? [])
      .filter(
        (v): v is { url: string; width: number } =>
          typeof v.url === "string" && typeof v.width === "number"
      )
      // Only Instagram's own media hosts: nothing a reply names elsewhere.
      .filter((v) => {
        try {
          const url = new URL(v.url);
          return (
            url.protocol === "https:" &&
            /(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(url.hostname)
          );
        } catch {
          return false;
        }
      })
      // Nearest 720 wide first: sharp enough to read, small enough to send.
      .sort((a, b) => Math.abs(a.width - 720) - Math.abs(b.width - 720))
      .slice(0, 3);
  } catch {
    return fail("info");
  }
  if (!versions.length) return fail("no_video");

  let video: Blob | undefined;
  let tooLarge = false;
  for (const { url } of versions) {
    try {
      // A signed URL: no cookies go to the media host.
      const res = await fetch(url, {
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok || !res.body) continue;
      if (!res.headers.get("content-type")?.startsWith("video/")) continue;
      const reader = res.body.getReader();
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let size = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limits.maxBytes) {
          await reader.cancel();
          break;
        }
        chunks.push(new Uint8Array(value));
      }
      if (size > limits.maxBytes) {
        tooLarge = true;
        continue;
      }
      video = new Blob(chunks, { type: "video/mp4" });
      break;
    } catch {
      continue;
    }
  }
  if (!video) return fail(tooLarge ? "too_large" : "no_video");

  const object = URL.createObjectURL(video);
  const element = document.createElement("video");
  try {
    element.muted = true;
    element.preload = "auto";
    const ready = once(element, "loadedmetadata", 15_000);
    element.src = object;
    await ready;
    const duration = element.duration;
    if (!Number.isFinite(duration) || duration <= 0) return fail("video");
    if (duration > limits.maxSeconds) return fail("too_long");
    const width = Math.min(element.videoWidth, 540);
    const height = Math.round(
      (element.videoHeight * width) / element.videoWidth
    );
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return fail("video");
    const frames: Extract<ReelRead, { ok: true }>["frames"] = [];
    for (let i = 0; i < limits.maxFrames; i++) {
      const seconds = (duration * (i + 0.5)) / limits.maxFrames;
      const seeked = once(element, "seeked", 10_000);
      element.currentTime = seconds;
      await seeked;
      context.drawImage(element, 0, 0, width, height);
      for (const quality of [0.7, 0.5, 0.35]) {
        const jpeg = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", quality)
        );
        if (jpeg && jpeg.size <= limits.frameMaxBytes) {
          frames.push({
            seconds,
            data: await dataUrl(jpeg),
            bytes: jpeg.size,
            width,
            height,
          });
          break;
        }
      }
    }
    if (!frames.length) return fail("video");
    return {
      ok: true,
      video: await dataUrl(video),
      bytes: video.size,
      duration,
      frames,
    };
  } catch {
    return fail("video");
  } finally {
    URL.revokeObjectURL(object);
    element.remove();
  }
}
