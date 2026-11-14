/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const assistants = vi.fn();
const activity = vi.fn();
const revoke = vi.fn();
vi.mock("../api", () => ({
  api: {
    api: {
      assistants: {
        $get: (...a: unknown[]) => assistants(...a),
        $post: vi.fn(),
        activity: { $get: (...a: unknown[]) => activity(...a) },
        ":id": { $delete: (...a: unknown[]) => revoke(...a) },
      },
    },
  },
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    search,
    children,
    ...rest
  }: {
    to: string;
    search: { memory: string };
    children: ReactNode;
  }) => (
    <a href={`${to}?memory=${search.memory}`} {...rest}>
      {children}
    </a>
  ),
}));

import { ConnectedAssistants } from "./connected-assistants";

const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});
const row = (over = {}) => ({
  id: "t1",
  name: "Claude Code",
  clientId: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  expiresAt: "2027-02-01T00:00:00.000Z",
  lastActiveAt: null,
  ...over,
});
const entry = (id: string, over = {}) => ({
  id,
  clientId: null,
  assistant: "Claude Code",
  tool: "search_memories",
  occurredAt: "2026-11-13T10:00:00.000Z",
  resultCount: 3,
  memory: null,
  ...over,
});

let host: HTMLElement;
let root: ReturnType<typeof createRoot>;
const flush = () => act(async () => {});
const button = (name: string | RegExp) =>
  [...document.querySelectorAll("button")].find((b) =>
    typeof name === "string"
      ? b.getAttribute("aria-label") === name || b.textContent === name
      : name.test(b.getAttribute("aria-label") ?? b.textContent ?? "")
  ) as HTMLButtonElement;
const click = (el: Element | undefined) =>
  act(async () => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

async function show(rows: unknown[]) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  assistants.mockResolvedValue(json({ assistants: rows }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<ConnectedAssistants />));
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("Connected Assistants in Settings", () => {
  it("shows each assistant with its last activity, or that it was never used", async () => {
    const today = new Date().toISOString();
    await show([
      row({ lastActiveAt: today }),
      row({ id: "t2", name: "Codex" }),
    ]);
    const items = [...host.querySelectorAll("li")].map((li) => li.textContent);
    expect(items[0]).toContain("Claude Code");
    expect(items[0]).toContain("Today");
    expect(items[1]).toContain("Codex");
    expect(items[1]).toContain("Not Used Yet");
  });

  it("asks for confirmation naming the assistant, and revokes only after it", async () => {
    revoke.mockResolvedValue({ ok: true, status: 204 });
    await show([row()]);
    await click(button("Revoke Claude Code"));
    expect(revoke).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Revoke Claude Code");
    await click(button("Cancel"));
    expect(revoke).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Claude Code");

    await click(button("Revoke Claude Code"));
    await click(
      [...document.querySelectorAll('[role="dialog"] button')].find(
        (b) => b.textContent === "Revoke"
      )
    );
    expect(revoke).toHaveBeenCalledWith(
      { param: { id: "t1" } },
      expect.anything()
    );
    await flush();
    expect(host.querySelector("li")).toBeNull();
  });

  it("keeps the assistant and says so when revoking fails", async () => {
    revoke.mockResolvedValue({ ok: false, status: 500 });
    await show([row()]);
    await click(button("Revoke Claude Code"));
    await click(
      [...document.querySelectorAll('[role="dialog"] button')].find(
        (b) => b.textContent === "Revoke"
      )
    );
    await flush();
    expect(document.body.textContent).toContain("Could Not Revoke");
    expect(host.querySelector("li")).not.toBeNull();
  });

  it("shows an empty state with the guide when nothing is connected", async () => {
    await show([]);
    expect(host.textContent).toContain("No Connected Assistants");
    expect(button("Connection Guide")).toBeTruthy();
  });

  it("lists activity as tool, time and result count, links an opened Memory and pages with Load More", async () => {
    activity
      .mockResolvedValueOnce(
        json({
          activity: [
            entry("9", {
              tool: "get_memory",
              resultCount: 1,
              memory: { id: "m1", title: "Bread Notes" },
            }),
            entry("8", { tool: "get_memory", resultCount: 0 }),
          ],
          next: "8",
        })
      )
      .mockResolvedValueOnce(
        json({ activity: [entry("7", { resultCount: 1 })], next: null })
      );
    await show([row()]);
    await click(button("Activity of Claude Code"));
    await flush();
    expect(activity).toHaveBeenCalledWith(
      { query: { assistant: "t1" } },
      expect.anything()
    );
    const dialog = document.querySelector('[role="dialog"]')!;
    const link = dialog.querySelector("a")!;
    expect(link.textContent).toBe("Bread Notes");
    expect(link.getAttribute("href")).toBe("/?memory=m1");
    const lines = [...dialog.querySelectorAll("li")].map(
      (li) => li.textContent
    );
    expect(lines[0]).toContain("Opened Memory");
    expect(lines[0]).toContain("1 Result");
    expect(lines[1]).toContain("0 Results");
    expect(dialog.querySelectorAll("a")).toHaveLength(1);

    await click(button("Load More"));
    await flush();
    expect(activity).toHaveBeenLastCalledWith(
      { query: { assistant: "t1", before: "8" } },
      expect.anything()
    );
    const all = [...dialog.querySelectorAll("li")].map((li) => li.textContent);
    expect(all).toHaveLength(3);
    expect(all[2]).toContain("Searched");
    expect(button("Load More")).toBeUndefined();
  });

  it("shows an empty log and a retry when activity cannot load", async () => {
    activity
      .mockResolvedValueOnce(json({ activity: [], next: null }))
      .mockResolvedValueOnce(json({}, 500))
      .mockResolvedValueOnce(json({ activity: [entry("1")], next: null }));
    await show([row()]);
    await click(button("Activity of Claude Code"));
    await flush();
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain(
      "No Activity"
    );
    await click(button("Close"));
    await click(button("Activity of Claude Code"));
    await flush();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    await click(button("Try Again"));
    await flush();
    expect(document.querySelectorAll('[role="dialog"] li')).toHaveLength(1);
  });

  it("gives the server URL and each snippet a Copy button", async () => {
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: write },
      configurable: true,
    });
    await show([]);
    await click(button("Connection Guide"));
    const dialog = document.querySelector('[role="dialog"]')!;
    const url = `${window.location.origin}/api/mcp`;
    expect(dialog.textContent).toContain(
      `claude mcp add --transport http spark ${url}`
    );
    expect(dialog.textContent).not.toContain(
      `codex mcp add spark --url ${url}`
    );
    const copies = [...dialog.querySelectorAll("button")].filter((b) =>
      b.getAttribute("aria-label")?.startsWith("Copy ")
    );
    expect(copies).toHaveLength(2);
    await click(button(`Copy claude mcp add`));
    expect(write).toHaveBeenCalledWith(
      `claude mcp add --transport http spark ${url}`
    );
    expect(dialog.textContent).toContain("Copied");
  });
});
