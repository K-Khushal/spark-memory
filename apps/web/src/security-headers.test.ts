import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// public/_headers is what Workers Static Assets serves with every dashboard
// asset (SEC-4). These checks keep it in step with index.html.
const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");
const headers = read("../public/_headers");
const html = read("../index.html");

const header = (name: string) =>
  headers
    .split("\n")
    .find((line) =>
      line.trim().toLowerCase().startsWith(`${name.toLowerCase()}:`)
    )
    ?.trim()
    .slice(name.length + 1)
    .trim();

describe("dashboard security headers", () => {
  it("applies to every path", () => {
    expect(headers.split("\n").filter((line) => !line.startsWith("#"))[0]).toBe(
      "/*"
    );
  });

  it("sends the content policy as Report-Only for one release, never as both", () => {
    expect(header("Content-Security-Policy-Report-Only")).toBeDefined();
    expect(header("Content-Security-Policy")).toBeUndefined();
  });

  it("allows exactly the inline theme script in index.html, by its hash", () => {
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    expect(inline).toHaveLength(1);
    const hash = createHash("sha256").update(inline[0]![1]!).digest("base64");
    const policy = header("Content-Security-Policy-Report-Only")!;
    expect(policy).toContain(`'sha256-${hash}'`);
    // Inline styles are the one place 'unsafe-inline' stays (React style props).
    expect(policy).toMatch(/style-src 'self' 'unsafe-inline'/);
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
  });

  it("closes the document to framing, plugins and a changed base", () => {
    const policy = header("Content-Security-Policy-Report-Only")!;
    for (const directive of [
      "default-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "object-src 'none'",
    ]) {
      expect(policy).toContain(directive);
    }
  });

  it("sets the headers that work without a policy", () => {
    expect(header("X-Frame-Options")).toBe("DENY");
    expect(header("X-Content-Type-Options")).toBe("nosniff");
    expect(header("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(header("Permissions-Policy")).toContain("camera=()");
    expect(header("Cross-Origin-Opener-Policy")).toBe(
      "same-origin-allow-popups"
    );
  });
});
