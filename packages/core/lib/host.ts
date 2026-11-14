/**
 * A hostname as people read it: `xn--` labels decoded to Unicode (RFC 3492),
 * for display only. The stored URL and every filter keep the ASCII form.
 * A label that mixes Latin with Cyrillic or Greek stays as it was, so a
 * lookalike domain never reads as the real one.
 */
export function displayHost(hostname: string): string {
  return hostname
    .split(".")
    .map((label) => {
      if (!/^xn--/i.test(label)) return label;
      const decoded = decode(label.slice(4));
      return decoded && !mixesScripts(decoded) ? decoded : label;
    })
    .join(".");
}

const mixesScripts = (label: string) =>
  /[a-z]/i.test(label) && /[Ͱ-ϿЀ-ӿ]/.test(label);

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;

function adapt(delta: number, count: number, first: boolean) {
  delta = first ? Math.floor(delta / DAMP) : delta >> 1;
  delta += Math.floor(delta / count);
  let k = 0;
  while (delta > ((BASE - T_MIN) * T_MAX) >> 1) {
    delta = Math.floor(delta / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * delta) / (delta + SKEW));
}

const digit = (code: number) =>
  code >= 48 && code < 58
    ? code - 22
    : code >= 65 && code < 91
      ? code - 65
      : code >= 97 && code < 123
        ? code - 97
        : BASE;

/** RFC 3492 Punycode decoding; undefined for input that is not valid Punycode. */
function decode(input: string): string | undefined {
  const basic = input.lastIndexOf("-");
  const out: number[] = [];
  for (let i = 0; i < Math.max(basic, 0); i++) {
    const code = input.charCodeAt(i);
    if (code >= 0x80) return undefined;
    out.push(code);
  }
  let n = 0x80;
  let bias = 72;
  let i = 0;
  for (let at = basic > 0 ? basic + 1 : 0; at < input.length;) {
    const before = i;
    for (let weight = 1, k = BASE; ; k += BASE) {
      if (at >= input.length) return undefined;
      const d = digit(input.charCodeAt(at++));
      if (d >= BASE) return undefined;
      i += d * weight;
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
      if (d < t) break;
      weight *= BASE - t;
    }
    bias = adapt(i - before, out.length + 1, before === 0);
    n += Math.floor(i / (out.length + 1));
    i %= out.length + 1;
    if (n > 0x10ffff) return undefined;
    out.splice(i++, 0, n);
  }
  return String.fromCodePoint(...out);
}
