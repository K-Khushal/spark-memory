// A signed-in device's name from its user agent, for the Sessions list:
// "Chrome on macOS". Only the common browsers and systems; anything else
// keeps whichever half is known.

const BROWSERS: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/iPhone/, "iPhone"],
  [/iPad/, "iPad"],
  [/Android/, "Android"],
  [/CrOS/, "ChromeOS"],
  [/Windows/, "Windows"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/Linux/, "Linux"],
];

const find = (ua: string, list: [RegExp, string][]) =>
  list.find(([pattern]) => pattern.test(ua))?.[1];

export function deviceName(userAgent: string | null): string {
  const ua = userAgent ?? "";
  const browser = find(ua, BROWSERS);
  const system = find(ua, SYSTEMS);
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? "Unknown Device";
}
