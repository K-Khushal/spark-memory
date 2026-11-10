import { describe, expect, it } from "vitest";
import { draftStore } from "./drafts";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const blocked = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

describe("unsaved Memory drafts", () => {
  it("keeps an edit until it is saved", () => {
    const drafts = draftStore(memoryStorage());
    const draft = { title: "T", body: "Long text", captureNote: "" };
    drafts.keep("m1", draft);
    expect(drafts.read("m1")).toEqual(draft);
    drafts.saved("m1", draft);
    expect(drafts.read("m1")).toBeUndefined();
  });

  it("keeps a newer draft when an older save lands", () => {
    const drafts = draftStore(memoryStorage());
    const older = { title: "", body: "One", captureNote: "" };
    const newer = { title: "", body: "One two", captureNote: "" };
    drafts.keep("m1", newer);
    drafts.saved("m1", older);
    expect(drafts.read("m1")).toEqual(newer);
  });

  it("does nothing, without throwing, when storage is blocked or full", () => {
    const drafts = draftStore(blocked);
    const draft = { title: "", body: "x", captureNote: "" };
    expect(() => drafts.keep("m1", draft)).not.toThrow();
    expect(drafts.read("m1")).toBeUndefined();
    expect(() => drafts.saved("m1", draft)).not.toThrow();
  });

  it("ignores a stored value that is not a draft", () => {
    const storage = memoryStorage();
    storage.setItem("spark-draft:m1", "{not json");
    expect(draftStore(storage).read("m1")).toBeUndefined();
  });
});
