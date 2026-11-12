import { expect, it } from "vitest";
import { extensionOrigins } from "../src/origin";
it("accepts bounded exact Chrome and Firefox origins, failing closed for malformed config", () => {
  const chrome = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const firefox = "moz-extension://12345678-1234-1234-1234-123456789abc";
  expect(extensionOrigins(chrome + "," + firefox)).toEqual([chrome, firefox]);
  for (const invalid of [
    chrome + ",*",
    "moz-extension://*",
    chrome + "/path",
    Array(9).fill(chrome).join(","),
  ])
    expect(extensionOrigins(invalid)).toEqual([]);
});
