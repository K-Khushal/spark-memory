/** Limits for gathering a link from its Source (PLAN.md §5.3.1). */
export const GATHER = {
  /** Fixed and honest: who is asking, and where to read why. */
  userAgent: "SparkBot/1.0 (+https://sparkmemory.xyz/bot)",
  maxRedirects: 5,
  timeoutMs: 8_000,
  readerTimeoutMs: 15_000,
  dnsTimeoutMs: 3_000,
  /** HTML read per page: metadata sits in the head, an article well inside this. */
  maxHtmlBytes: 1_000_000,
  maxJsonBytes: 256_000,
  /** Less readable text than this is a login wall or an app shell, not a Preserved copy. */
  minPreservedChars: 280,
  readerUrl: "https://r.jina.ai/",
  dohUrl: "https://cloudflare-dns.com/dns-query",
} as const;

/** A host's IPv4 and IPv6 addresses. Throws when it cannot be asked. */
export type Resolve = (host: string) => Promise<string[]>;

export type Refusal =
  | "scheme"
  | "credentials"
  | "port"
  | "private_address"
  | "unresolved"
  | "too_many_redirects"
  | "content_type"
  | "status"
  /** These may pass: the Source or the network is down for now. */
  | "unavailable"
  | "timeout"
  | "network";

export type PublicResponse =
  | { ok: true; url: string; type: string; text: string; truncated: boolean }
  | { ok: false; reason: Refusal };

export const isTransient = (reason: Refusal) =>
  reason === "unavailable" || reason === "timeout" || reason === "network";

const HTML = ["text/html", "application/xhtml+xml"];

// IPv4 blocks that are not the public internet (RFC 6890 and friends).
const PRIVATE_V4: [number, number][] = [
  [0x00000000, 8], // "this" network
  [0x0a000000, 8], // private
  [0x64400000, 10], // carrier-grade NAT
  [0x7f000000, 8], // loopback
  [0xa9fe0000, 16], // link-local, cloud metadata (169.254.169.254)
  [0xac100000, 12], // private
  [0xc0000000, 24], // IETF protocol assignments
  [0xc0000200, 24], // documentation
  [0xc0586300, 24], // 6to4 relay anycast
  [0xc0a80000, 16], // private
  [0xc6120000, 15], // benchmarking
  [0xc6336400, 24], // documentation
  [0xcb007100, 24], // documentation
  [0xe0000000, 3], // multicast and reserved, up to 255.255.255.255
];

function v4(address: string): number | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) return undefined;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return undefined;
    n = n * 256 + Number(p);
  }
  return n;
}

const privateV4 = (n: number) =>
  PRIVATE_V4.some(([base, bits]) => n >>> (32 - bits) === base >>> (32 - bits));

/** Eight 16-bit groups, or undefined when it is not an IPv6 address. */
function v6(address: string): number[] | undefined {
  let s = address.toLowerCase();
  const tail: number[] = [];
  const dotted = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const n = v4(dotted[2]!);
    if (n === undefined) return undefined;
    tail.push(n >>> 16, n & 0xffff);
    const before = dotted[1]!;
    s = before.endsWith("::") ? before : before.slice(0, -1);
  }
  const halves = s.split("::");
  if (halves.length > 2) return undefined;
  const group = (h: string) => (h ? h.split(":") : []);
  const head = group(halves[0]!);
  const rest = halves.length === 2 ? group(halves[1]!) : [];
  const groups = [...head, ...rest].map((g) =>
    /^[\da-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN
  );
  if (groups.some(Number.isNaN)) return undefined;
  const missing = 8 - groups.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  return [
    ...groups.slice(0, head.length),
    ...Array<number>(halves.length === 2 ? missing : 0).fill(0),
    ...groups.slice(head.length),
    ...tail,
  ];
}

/**
 * Only global unicast (2000::/3) is public; addresses that carry an IPv4
 * one (mapped, compatible, NAT64, 6to4) are judged by it.
 */
function privateV6(g: number[]): boolean {
  const embedded = (hi: number, lo: number) => privateV4(hi * 65536 + lo);
  const zeros = (from: number, to: number) =>
    g.slice(from, to).every((x) => x === 0);
  if (zeros(0, 5) && (g[5] === 0xffff || g[5] === 0)) {
    return g[5] === 0 && g[6] === 0 ? true : embedded(g[6]!, g[7]!);
  }
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    return zeros(2, 6) ? embedded(g[6]!, g[7]!) : true;
  }
  if (g[0] === 0x2002) return embedded(g[1]!, g[2]!);
  if ((g[0]! & 0xe000) !== 0x2000) return true;
  // Teredo (2001::/32) and documentation (2001:db8::/32).
  return g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8);
}

/** Whether an address (either family) is anywhere but the public internet. */
export function isPrivateAddress(address: string): boolean {
  const n = v4(address);
  if (n !== undefined) return privateV4(n);
  const groups = v6(address.replace(/^\[|\]$/g, "").split("%")[0]!);
  return groups ? privateV6(groups) : true;
}

const LOCAL_NAME = /(^|\.)(localhost|local|internal|lan|home\.arpa)$/i;

/** The URL if it may be fetched, else why not. */
async function check(href: string, resolve: Resolve): Promise<URL | Refusal> {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return "scheme";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "scheme";
  if (url.username || url.password) return "credentials";
  // Only the web's own ports: never a database or admin port on some host.
  if (url.port !== "") return "port";
  const host = url.hostname;
  if (host.startsWith("[") || v4(host) !== undefined) {
    return isPrivateAddress(host) ? "private_address" : url;
  }
  if (!host.includes(".") || LOCAL_NAME.test(host.replace(/\.$/, ""))) {
    return "private_address";
  }
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return "network";
  }
  if (!addresses.length) return "unresolved";
  return addresses.some(isPrivateAddress) ? "private_address" : url;
}

/** The body's charset: the header's, else a <meta charset> near the start, else UTF-8. */
function charsetOf(header: string, head: Uint8Array) {
  const declared =
    header.match(/charset=["']?([\w-]+)/i)?.[1] ??
    new TextDecoder("latin1")
      .decode(head.subarray(0, 1024))
      .match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  try {
    return new TextDecoder(declared ?? "utf-8");
  } catch {
    return new TextDecoder("utf-8");
  }
}

/** Reads at most `max` bytes of a body, then lets go of the rest. */
async function readCapped(body: ReadableStream<Uint8Array>, max: number) {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = max - size;
    chunks.push(value.length > room ? value.subarray(0, room) : value);
    size += Math.min(room, value.length);
    if (value.length >= room) {
      truncated = value.length > room || !(await reader.read()).done;
      await reader.cancel().catch(() => {});
      break;
    }
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return { bytes, truncated };
}

/**
 * Fetches a URL only if it, and every redirect, is on the public web:
 * http(s) on the default port, no credentials, and a host whose every
 * address is public. Within a time limit and a byte cap, only of the types
 * asked for, with a fixed User-Agent and no cookies or auth. On Workers
 * fetch resolves the name again, so this check guards against what it can
 * see; Cloudflare refuses private destinations from Workers itself.
 */
export async function publicFetch(
  href: string,
  {
    fetch,
    resolve,
    accept = HTML,
    maxBytes = GATHER.maxHtmlBytes,
    timeoutMs = GATHER.timeoutMs,
    headers = {},
  }: {
    fetch: typeof globalThis.fetch;
    resolve: Resolve;
    accept?: readonly string[];
    maxBytes?: number;
    timeoutMs?: number;
    headers?: Record<string, string>;
  }
): Promise<PublicResponse> {
  const signal = AbortSignal.timeout(timeoutMs);
  let current = href;
  for (let hop = 0; ; hop++) {
    const url = await check(current, resolve);
    if (typeof url === "string") return { ok: false, reason: url };
    let res: Response;
    try {
      res = await fetch(url.href, {
        redirect: "manual",
        signal,
        headers: {
          ...headers,
          "user-agent": GATHER.userAgent,
          accept: [...accept, "*/*;q=0.1"].join(", "),
        },
      });
    } catch {
      return { ok: false, reason: signal.aborted ? "timeout" : "network" };
    }
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => {});
      if (hop >= GATHER.maxRedirects) {
        return { ok: false, reason: "too_many_redirects" };
      }
      current = new URL(location, url).href;
      continue;
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => {});
      const down = res.status >= 500 || res.status === 429;
      return { ok: false, reason: down ? "unavailable" : "status" };
    }
    const header = res.headers.get("content-type") ?? "";
    const type = header.split(";")[0]!.trim().toLowerCase();
    if (!accept.includes(type)) {
      await res.body.cancel().catch(() => {});
      return { ok: false, reason: "content_type" };
    }
    try {
      const { bytes, truncated } = await readCapped(res.body, maxBytes);
      const text = charsetOf(header, bytes).decode(bytes);
      return { ok: true, url: url.href, type, text, truncated };
    } catch {
      return { ok: false, reason: signal.aborted ? "timeout" : "network" };
    }
  }
}

/**
 * Resolves through DNS over HTTPS (Workers has no resolver of its own):
 * the A and AAAA records, CNAMEs followed by the resolver.
 */
export function dohResolver(
  fetch: typeof globalThis.fetch,
  endpoint: string = GATHER.dohUrl
): Resolve {
  const ask = async (host: string, type: "A" | "AAAA") => {
    const res = await fetch(
      `${endpoint}?name=${encodeURIComponent(host)}&type=${type}`,
      {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(GATHER.dnsTimeoutMs),
      }
    );
    if (!res.ok) throw new Error(`dns ${res.status}`);
    const { Answer = [] } = (await res.json()) as {
      Answer?: { type: number; data: string }[];
    };
    return Answer.filter((a) => a.type === (type === "A" ? 1 : 28)).map(
      (a) => a.data
    );
  };
  return async (host) =>
    (await Promise.all([ask(host, "A"), ask(host, "AAAA")])).flat();
}
