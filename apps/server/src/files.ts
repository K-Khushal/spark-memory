import { AwsV4Signer } from "aws4fetch";
import type { FileUpload, Memory } from "@spark/db";
import type { Bindings } from "./env";

/**
 * Memory files in object storage (R2). Browsers upload and download them
 * directly with short-lived presigned URLs, so file bytes never pass through
 * the Worker. Each URL is for one key, one method and, for an upload, one
 * exact type and size. Locally (no R2 credentials) the URLs point at this
 * Worker's own /api/local-files route, signed the same way in spirit, so the
 * flow is the same end to end without real credentials.
 */
export type FileStore = {
  /** Where and how the browser PUTs `file`: the URL and the headers it must send. */
  signUpload(file: FileUpload): Promise<SignedUpload>;
  /** A URL that GETs `key` for a while (the same URL within the hour, so browsers cache it). */
  signDownload(key: string): Promise<string>;
  /** Whether `file` arrived as described; a file that did not match is deleted. */
  check(file: FileUpload): Promise<"stored" | "missing" | "mismatch">;
  remove(keys: string[]): Promise<void>;
};

export type SignedUpload = { url: string; headers: Record<string, string> };

/** Files never change once stored, and only their owner ever has a URL. */
export const FILE_CACHE_CONTROL = "private, max-age=31536000, immutable";
const UPLOAD_SECONDS = 15 * 60;
/** Download URLs are signed at the start of the hour and last two. */
const DOWNLOAD_SECONDS = 2 * 60 * 60;
const HOUR_MS = 60 * 60 * 1000;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** A local Worker on a local host, without R2 credentials: files go through itself. */
export const usesLocalFiles = (env: Bindings, requestUrl: string) =>
  env.SPARK_ENV === "local" &&
  !env.R2_ACCESS_KEY_ID &&
  LOCAL_HOSTS.has(new URL(requestUrl).hostname);

export function fileStore(env: Bindings, requestUrl: string): FileStore {
  // Made on first use, so missing R2 secrets fail only what needs a URL.
  let signer: Signer | undefined;
  const sign = () =>
    (signer ??= usesLocalFiles(env, requestUrl)
      ? localSigner(env.BETTER_AUTH_SECRET)
      : r2Signer(env));
  const bucket = env.FILES;
  return {
    signUpload: async (file) => sign().signUpload(file),
    signDownload: async (key) => sign().signDownload(key),
    async check(file) {
      const object = await bucket.head(file.key);
      if (!object) return "missing";
      if (
        object.size === file.bytes &&
        object.httpMetadata?.contentType === file.mime
      ) {
        return "stored";
      }
      await bucket.delete(file.key);
      return "mismatch";
    },
    remove: async (keys) => {
      if (keys.length) await bucket.delete(keys);
    },
  };
}

type Signer = Pick<FileStore, "signUpload" | "signDownload">;

const amzDate = (at: Date) => at.toISOString().replace(/[:-]|\.\d{3}/g, "");
const startOfHour = () => new Date(Math.floor(Date.now() / HOUR_MS) * HOUR_MS);
const encodeKey = (key: string) =>
  key.split("/").map(encodeURIComponent).join("/");

/** Presigned URLs on R2's S3 endpoint (bindings cannot presign). */
function r2Signer(env: Bindings): Signer {
  const {
    R2_ACCOUNT_ID: account,
    R2_BUCKET: bucket,
    R2_ACCESS_KEY_ID: accessKeyId,
    R2_SECRET_ACCESS_KEY: secretAccessKey,
  } = env;
  if (!account || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must be set (docs/deploy.md)"
    );
  }
  const cache = new Map<string, ArrayBuffer>();
  async function presign(
    method: "PUT" | "GET",
    key: string,
    seconds: number,
    headers: Record<string, string>,
    at: Date
  ) {
    const url = new URL(
      `https://${account}.r2.cloudflarestorage.com/${bucket}/${encodeKey(key)}`
    );
    url.searchParams.set("X-Amz-Expires", String(seconds));
    const signer = new AwsV4Signer({
      method,
      url: url.toString(),
      headers,
      accessKeyId: accessKeyId!,
      secretAccessKey: secretAccessKey!,
      service: "s3",
      region: "auto",
      signQuery: true,
      // Sign content-type, content-length and cache-control too, so the
      // upload must be exactly the file the Memory describes.
      allHeaders: true,
      datetime: amzDate(at),
      cache,
    });
    return (await signer.sign()).url.toString();
  }
  return {
    async signUpload(file) {
      const headers = {
        "content-type": file.mime,
        "cache-control": FILE_CACHE_CONTROL,
      };
      const url = await presign(
        "PUT",
        file.key,
        UPLOAD_SECONDS,
        { ...headers, "content-length": String(file.bytes) },
        new Date()
      );
      return { url, headers };
    },
    signDownload: (key) =>
      presign("GET", key, DOWNLOAD_SECONDS, {}, startOfHour()),
  };
}

const LOCAL_PREFIX = "/api/local-files/";

async function hmac(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    // Its own key, derived from the local secret, never the session one.
    new TextEncoder().encode(`spark-local-files\n${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );
  return [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** What a local URL signs: method, key, expiry, and for an upload its type and size. */
const localMessage = (
  method: string,
  key: string,
  expires: string,
  mime = "",
  bytes = ""
) => [method, key, expires, mime, bytes].join("\n");

function localSigner(secret: string): Signer {
  async function url(
    method: string,
    key: string,
    expires: number,
    mime?: string,
    bytes?: number
  ) {
    const exp = String(expires);
    const sig = await hmac(
      secret,
      localMessage(method, key, exp, mime, bytes?.toString())
    );
    return `${LOCAL_PREFIX}${encodeKey(key)}?expires=${exp}&sig=${sig}`;
  }
  const inSeconds = (s: number, from = Date.now()) =>
    Math.floor(from / 1000) + s;
  return {
    signUpload: async (file) => ({
      url: await url(
        "PUT",
        file.key,
        inSeconds(UPLOAD_SECONDS),
        file.mime,
        file.bytes
      ),
      headers: {
        "content-type": file.mime,
        "cache-control": FILE_CACHE_CONTROL,
      },
    }),
    signDownload: (key) =>
      url("GET", key, inSeconds(DOWNLOAD_SECONDS, startOfHour().getTime())),
  };
}

/**
 * Checks a local file URL as R2 would check a presigned one. Returns the
 * key when the signature, expiry and (for a PUT) type and size all match.
 */
export async function verifyLocalUrl(
  secret: string,
  request: Request
): Promise<string | undefined> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(LOCAL_PREFIX)) return undefined;
  const key = url.pathname
    .slice(LOCAL_PREFIX.length)
    .split("/")
    .map(decodeURIComponent)
    .join("/");
  const expires = url.searchParams.get("expires") ?? "";
  const sig = url.searchParams.get("sig") ?? "";
  if (!/^\d+$/.test(expires) || Number(expires) * 1000 < Date.now()) {
    return undefined;
  }
  const upload = request.method === "PUT";
  const expected = await hmac(
    secret,
    localMessage(
      request.method === "HEAD" ? "GET" : request.method,
      key,
      expires,
      upload ? (request.headers.get("content-type") ?? "") : undefined,
      upload ? (request.headers.get("content-length") ?? "") : undefined
    )
  );
  return expected === sig ? key : undefined;
}

/** A Memory as clients get it: its files as signed URLs, never as keys. */
export type ClientMemory = Omit<
  Memory,
  "image" | "indexRun" | "indexPriority"
> & {
  image: {
    url: string;
    thumbnailUrl: string;
    mime: string;
    bytes: number;
    width: number;
    height: number;
    thumbhash: string;
  } | null;
};

export async function forClient<M extends Memory>(
  store: FileStore,
  memory: M
): Promise<
  Omit<M, "image" | "indexRun" | "indexPriority"> & Pick<ClientMemory, "image">
> {
  const { image, indexRun: _run, indexPriority: _priority, ...rest } = memory;
  if (!image) return { ...rest, image: null };
  const { key, thumbnailKey, thumbnailMime: _, ...shown } = image;
  const [url, thumbnailUrl] = await Promise.all([
    store.signDownload(key),
    store.signDownload(thumbnailKey),
  ]);
  return { ...rest, image: { ...shown, url, thumbnailUrl } };
}
