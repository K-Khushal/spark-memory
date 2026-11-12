import { describe, expect, it } from "vitest";
import {
  databaseUrl,
  email,
  fakeTurnstile,
  lastCode,
  newClient,
  sendCode,
} from "./worker";

fakeTurnstile();
describe.skipIf(!databaseUrl)("onboarding HTTP", () => {
  it("requires sign-in, validates progress and records an opened result just once", async () => {
    const call = newClient();
    expect((await call("/api/onboarding")).status).toBe(401);
    const address = email();
    await sendCode(call, address);
    await call("/api/auth/sign-in/email-otp", {
      method: "POST",
      json: { email: address, otp: await lastCode(call, address) },
    });
    expect(await (await call("/api/onboarding")).json()).toMatchObject({
      step: "disclosure",
    });
    expect(
      (
        await call("/api/onboarding", {
          method: "PUT",
          json: { step: "bogus", paused: false },
        })
      ).status
    ).toBe(400);
    expect(
      (await call("/api/onboarding/start", { method: "POST" })).status
    ).toBe(200);
    const { memories } = (await (await call("/api/memories")).json()) as {
      memories: { id: string; sample: boolean }[];
    };
    expect(memories).toHaveLength(3);
    const json = { memoryId: memories[0]!.id };
    expect(
      await (
        await call("/api/onboarding/activation", { method: "POST", json })
      ).json()
    ).toEqual({ recorded: true });
    expect(
      await (
        await call("/api/onboarding/activation", { method: "POST", json })
      ).json()
    ).toEqual({ recorded: false });
    expect(
      (await call("/api/onboarding/samples", { method: "DELETE" })).status
    ).toBe(204);
    expect(await (await call("/api/memories")).json()).toMatchObject({
      memories: [],
    });
  });
});
