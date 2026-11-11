import { rgbaToThumbHash } from "thumbhash";
import {
  FREE_ALLOWANCE,
  IMAGE_TYPES,
  isFileWithinAllowance,
  THUMBNAIL_MAX_BYTES,
  type ImageType,
} from "@spark/core";

/** Why an image cannot be Captured. */
export type ImageRefusal =
  "unsupported" | "file_too_large" | "storage_full" | "unreadable";

/**
 * An image ready to Capture: the Preserved copy (the original file, or a
 * JPEG for HEIC) with what the server and the wall need to know about it.
 */
export type PreparedImage = {
  file: Blob;
  mime: ImageType;
  width: number;
  height: number;
  /** SHA-256 of `file`, hex. */
  contentHash: string;
  /** ThumbHash, base64. */
  thumbhash: string;
  thumbnail: Blob;
  thumbnailMime: "image/webp" | "image/jpeg";
};

const HEIC = /\.(heic|heif)$/i;
const BY_EXTENSION: Record<string, ImageType> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

const isHeic = (file: File) =>
  /^image\/hei[cf]/.test(file.type) || HEIC.test(file.name);

/** The type a file will be kept as, or undefined when Spark does not keep it. */
export function keptType(file: File): ImageType | undefined {
  if (isHeic(file)) return "image/jpeg";
  if ((IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return file.type as ImageType;
  }
  if (file.type) return undefined;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return BY_EXTENSION[ext];
}

/**
 * Checks a file before any work, against the Free allowance: a type Spark
 * keeps, at most 25 MB, and room in storage. The server checks again.
 */
export function checkImage(
  file: File,
  usedStorageBytes: number
): ImageRefusal | undefined {
  if (!keptType(file)) return "unsupported";
  const allowed = isFileWithinAllowance({
    fileBytes: file.size,
    usedStorageBytes,
  });
  return allowed.ok ? undefined : allowed.reason;
}

/** Thumbnails fill a tile at twice the widest column. */
const THUMBNAIL_WIDTH = 720;
const THUMBNAIL_MAX_HEIGHT = 2160;
const THUMBHASH_SIZE = 100;

/**
 * Decodes `file` (EXIF orientation applied), converts HEIC to JPEG, and makes
 * the thumbnail, ThumbHash and content hash. Rejects with "unreadable" or
 * "file_too_large" (a HEIC that grew past 25 MB as JPEG).
 *
 * The Preserved copy is the original file byte for byte, metadata included
 * (it is served only to its owner). A HEIC is re-encoded to JPEG, which keeps
 * no EXIF at all: no location, no camera, no date.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const heic = isHeic(file);
  const bitmap = await decode(file, heic).catch(() => {
    throw "unreadable" satisfies ImageRefusal;
  });
  try {
    const kept = heic ? await encode(bitmap, "image/jpeg", 0.9) : file;
    if (kept.size > FREE_ALLOWANCE.maxUploadBytes) {
      throw "file_too_large" satisfies ImageRefusal;
    }
    const scale = Math.min(
      1,
      THUMBNAIL_WIDTH / bitmap.width,
      THUMBNAIL_MAX_HEIGHT / bitmap.height
    );
    // Busy images can make a large thumbnail: lower the quality, then the
    // size, until it fits the server's limit.
    let thumbnail = await encode(bitmap, "image/webp", 0.8, scale);
    for (const [quality, smaller] of [
      [0.6, 1],
      [0.5, 0.75],
      [0.5, 0.5],
    ] as const) {
      if (thumbnail.size <= THUMBNAIL_MAX_BYTES) break;
      thumbnail = await encode(bitmap, "image/webp", quality, scale * smaller);
    }
    if (thumbnail.size > THUMBNAIL_MAX_BYTES) {
      throw "unreadable" satisfies ImageRefusal;
    }
    return {
      file: kept,
      mime: keptType(file)!,
      width: bitmap.width,
      height: bitmap.height,
      contentHash: await sha256(kept),
      thumbhash: thumbhashOf(bitmap),
      thumbnail,
      // Safari cannot write WebP and falls back to PNG: use JPEG there.
      thumbnailMime:
        thumbnail.type === "image/webp" ? "image/webp" : "image/jpeg",
    };
  } finally {
    bitmap.close();
  }
}

async function decode(file: File, heic: boolean): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (error) {
    if (!heic) throw error;
    // Safari decodes HEIC itself; elsewhere libheif, loaded only when needed.
    const { heicTo } = await import("heic-to");
    return heicTo({ blob: file, type: "bitmap" });
  }
}

function canvasOf(bitmap: ImageBitmap, scale = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d")!;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

async function encode(
  bitmap: ImageBitmap,
  type: string,
  quality: number,
  scale = 1
): Promise<Blob> {
  const { canvas } = canvasOf(bitmap, scale);
  let blob = await new Promise<Blob | null>((done) =>
    canvas.toBlob(done, type, quality)
  );
  if (blob && blob.type !== type) {
    blob = await new Promise<Blob | null>((done) =>
      canvas.toBlob(done, "image/jpeg", quality)
    );
  }
  if (!blob) throw "unreadable" satisfies ImageRefusal;
  return blob;
}

function thumbhashOf(bitmap: ImageBitmap) {
  const scale = THUMBHASH_SIZE / Math.max(bitmap.width, bitmap.height);
  const { canvas, context } = canvasOf(bitmap, Math.min(1, scale));
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const hash = rgbaToThumbHash(canvas.width, canvas.height, data);
  return btoa(String.fromCharCode(...hash));
}

async function sha256(blob: Blob) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer()
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
