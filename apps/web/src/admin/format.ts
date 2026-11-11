/** Micro-dollars as a dollar amount the admin can edit. */
export function microsToDollars(micros: number): string {
  return (micros / 1_000_000).toFixed(6).replace(/\.?0+$/, "");
}

/** A dollar amount typed by the admin, in micro-dollars. */
export function dollarsToMicros(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return undefined;
  const micros = Math.round(Number(trimmed) * 1_000_000);
  return Number.isSafeInteger(micros) ? micros : undefined;
}

/** Micro-dollars as USD. Under one cent, four places, so a small call still shows. */
export function formatCost(micros: number): string {
  const dollars = micros / 1_000_000;
  if (dollars !== 0 && Math.abs(dollars) < 0.01)
    return `$${dollars.toFixed(4)}`;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

/** Bytes the way the Free allowance is counted, short. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"] as const;
  let value = bytes / 1024;
  let unit: (typeof units)[number] = "KB";
  for (const next of units) {
    unit = next;
    if (value < 1024 || next === "GB") break;
    value /= 1024;
  }
  const digits = value >= 10 || Number.isInteger(value) ? 0 : 1;
  return `${value.toFixed(digits)} ${unit}`;
}
