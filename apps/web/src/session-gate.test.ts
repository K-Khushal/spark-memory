import { describe, expect, it, vi } from "vitest";
import { createSessionGate, type GateSession } from "./session-gate";

const ada: GateSession = {
  user: { id: "ada", email: "ada@example.com", name: "Ada" },
};

describe("session gate", () => {
  it("re-checks admin on demand, forgets it on 403, and does not cache a failed read", async () => {
    let answer: boolean | null = true;
    const readAdmin = vi.fn(async () => answer);
    const gate = createSessionGate({
      currentSession: async () => ada,
      readAdmin,
    });

    expect((await gate.require())?.admin).toBe(true);
    await gate.require();
    expect(readAdmin).toHaveBeenCalledTimes(1);

    answer = false;
    expect((await gate.require({ freshAdmin: true }))?.admin).toBe(false);
    expect(readAdmin).toHaveBeenCalledTimes(2);
    await gate.require();
    expect(readAdmin).toHaveBeenCalledTimes(2);

    answer = true;
    gate.noteStatus(500);
    await gate.require();
    expect(readAdmin).toHaveBeenCalledTimes(2);
    gate.noteStatus(403);
    expect((await gate.require())?.admin).toBe(true);
    expect(readAdmin).toHaveBeenCalledTimes(3);

    answer = null;
    expect((await gate.require({ freshAdmin: true }))?.admin).toBe(false);
    answer = true;
    expect((await gate.require())?.admin).toBe(true);
    expect(readAdmin).toHaveBeenCalledTimes(5);
  });
});
