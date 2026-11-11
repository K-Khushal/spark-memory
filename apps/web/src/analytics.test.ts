import { describe, expect, it, vi } from "vitest";
import { createAnalytics } from "./product-analytics";

describe("analytics identity", () => {
  it("forgets the old person on stop and identifies the next one", async () => {
    const clients: {
      userId: string;
      identify: ReturnType<typeof vi.fn>;
      reset: ReturnType<typeof vi.fn>;
      capture: ReturnType<typeof vi.fn>;
    }[] = [];
    const load = vi.fn(async (userId: string) => {
      const client = {
        userId,
        identify: vi.fn(),
        reset: vi.fn(),
        capture: vi.fn(),
      };
      clients.push(client);
      return client;
    });
    const analytics = createAnalytics(load);

    analytics.start("ada");
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    expect(clients[0]?.identify).toHaveBeenCalledWith("ada");

    analytics.start("ada-again");
    expect(load).toHaveBeenCalledTimes(1);
    expect(clients[0]?.identify).toHaveBeenCalledWith("ada-again");

    analytics.stop();
    expect(clients[0]?.reset).toHaveBeenCalledTimes(1);

    analytics.start("bo");
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(clients[1]?.identify).toHaveBeenCalledWith("bo");
    expect(clients[0]?.identify).not.toHaveBeenCalledWith("bo");
  });

  it("resets a client that arrives after stop", async () => {
    let finish: (client: {
      identify: () => void;
      reset: () => void;
      capture: () => void;
    }) => void = () => {};
    const reset = vi.fn();
    const analytics = createAnalytics(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    analytics.start("ada");
    analytics.stop();
    finish({ identify: vi.fn(), reset, capture: vi.fn() });
    await vi.waitFor(() => expect(reset).toHaveBeenCalledTimes(1));
  });
});
