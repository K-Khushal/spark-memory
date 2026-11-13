import { expect, it } from "vitest";
import { signInReturnTo } from "./return-to";

it("resumes OAuth only at Spark's own authorization endpoint", () => {
  expect(signInReturnTo("/api/oauth/authorize?client_id=known")).toBe(
    "/api/oauth/authorize?client_id=known"
  );
  for (const value of [
    "https://evil.example/",
    "//evil.example/api/oauth/authorize",
    "/api/oauth/authorize/../token?x=1",
    "/settings",
    null,
  ]) {
    expect(signInReturnTo(value)).toBeUndefined();
  }
});
