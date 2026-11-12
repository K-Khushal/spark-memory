import { FREE_ALLOWANCE, ImageCapture } from "@spark/core";
import { rgbaToThumbHash } from "thumbhash";
import { cropRect, type Point } from "./capture";

export type ImageBytes = { original: string; thumbnail: string };
const dataUrl = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${blob.type};base64,${btoa(binary)}`;
};
export const decodeData = (data: string) =>
  Uint8Array.from(atob(data.split(",")[1]!), (c) => c.charCodeAt(0));

/** No page credentials; no redirects to a host the person did not grant. */
export async function fetchImage(url: string, request: typeof fetch = fetch) {
  if (!/^https?:\/\//.test(url)) throw new Error("Unsupported Image");
  const response = await request(url, {
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok || !response.body) throw new Error("Try Again");
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > FREE_ALLOWANCE.maxUploadBytes)
        throw new Error("Image Too Large");
      chunks.push(new Uint8Array(value));
    }
  } finally {
    await reader.cancel();
  }
  return new Blob(chunks, {
    type: response.headers.get("content-type")?.split(";")[0],
  });
}
export async function prepareCapture(
  blob: Blob,
  region?: { a: Point; b: Point; width: number; height: number }
) {
  const bitmap = await createImageBitmap(blob);
  try {
    const rect = region
      ? cropRect(
          region.a,
          region.b,
          region.width,
          region.height,
          bitmap.width,
          bitmap.height
        )
      : { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
    const canvas = new OffscreenCanvas(rect.width, rect.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(
      bitmap,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      rect.width,
      rect.height
    );
    const original = region
      ? await canvas.convertToBlob({ type: "image/png" })
      : blob;
    if (original.size > FREE_ALLOWANCE.maxUploadBytes)
      throw new Error("Image Too Large");
    const scale = Math.min(1, 720 / rect.width, 2160 / rect.height);
    const thumb = new OffscreenCanvas(
      Math.max(1, Math.round(rect.width * scale)),
      Math.max(1, Math.round(rect.height * scale))
    );
    thumb.getContext("2d")!.drawImage(canvas, 0, 0, thumb.width, thumb.height);
    const thumbnail = await thumb.convertToBlob({
      type: "image/webp",
      quality: 0.7,
    });
    const smallScale = Math.min(1, 100 / Math.max(rect.width, rect.height));
    const small = new OffscreenCanvas(
      Math.max(1, Math.round(rect.width * smallScale)),
      Math.max(1, Math.round(rect.height * smallScale))
    );
    const smallCtx = small.getContext("2d")!;
    smallCtx.drawImage(canvas, 0, 0, small.width, small.height);
    const hash = rgbaToThumbHash(
      small.width,
      small.height,
      smallCtx.getImageData(0, 0, small.width, small.height).data
    );
    const digest = await crypto.subtle.digest(
      "SHA-256",
      await original.arrayBuffer()
    );
    const capture = ImageCapture.parse({
      id: crypto.randomUUID(),
      mime: original.type,
      bytes: original.size,
      width: rect.width,
      height: rect.height,
      contentHash: [...new Uint8Array(digest)]
        .map((n) => n.toString(16).padStart(2, "0"))
        .join(""),
      thumbhash: btoa(String.fromCharCode(...hash)),
      thumbnail: { mime: thumbnail.type, bytes: thumbnail.size },
    });
    return {
      capture,
      image: {
        original: await dataUrl(original),
        thumbnail: await dataUrl(thumbnail),
      },
    };
  } finally {
    bitmap.close();
  }
}
