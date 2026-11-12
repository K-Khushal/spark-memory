import { TextCapture } from "@spark/core";
export function selectionCapture(
  url: string,
  text: string,
  context: string,
  title: string,
  surrounding?: { prefix: string; suffix: string }
) {
  const source = new URL(url);
  const escape = (value: string) =>
    encodeURIComponent(value.replace(/\s+/g, " ").trim()).replace(/-/g, "%2D");
  const prefix = surrounding?.prefix.trim(),
    suffix = surrounding?.suffix.trim();
  source.hash =
    ":~:text=" +
    [
      prefix ? escape(prefix) + "-" : "",
      escape(text),
      suffix ? "-" + escape(suffix) : "",
    ]
      .filter(Boolean)
      .join(",");
  return TextCapture.parse({
    id: crypto.randomUUID(),
    body: text,
    title,
    source: { url: source.href, context: context.slice(0, 2000) },
  });
}
export function videoSource(url: string, time?: number) {
  const source = new URL(url);
  if (
    ["www.youtube.com", "youtube.com", "m.youtube.com", "youtu.be"].includes(
      source.hostname
    ) &&
    time !== undefined &&
    Number.isFinite(time) &&
    time >= 0
  )
    source.searchParams.set("t", Math.floor(time) + "s");
  return source.searchParams.has("t") ? source.href : url;
}
export type Point = { x: number; y: number };
export function cropRect(
  a: Point,
  b: Point,
  width: number,
  height: number,
  pixelsWide: number,
  pixelsHigh: number
) {
  const x = Math.max(0, Math.min(a.x, b.x));
  const y = Math.max(0, Math.min(a.y, b.y));
  const right = Math.min(width, Math.max(a.x, b.x));
  const bottom = Math.min(height, Math.max(a.y, b.y));
  if (right - x < 2 || bottom - y < 2)
    throw new Error("Select a Larger Region");
  return {
    x: Math.round((x * pixelsWide) / width),
    y: Math.round((y * pixelsHigh) / height),
    width: Math.round(((right - x) * pixelsWide) / width),
    height: Math.round(((bottom - y) * pixelsHigh) / height),
  };
}
