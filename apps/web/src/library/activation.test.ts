import { expect, it, vi } from "vitest";
import { createActivation } from "./activation";

it("stops posting once the first successful search is known", async () => {
  const post = vi.fn().mockResolvedValue("recorded");
  const activation = createActivation(post);
  expect(await activation.activate("a")).toBe("recorded");
  expect(await activation.activate("b")).toBe("known");
  expect(post).toHaveBeenCalledTimes(1);
});

it("does not post when the server state already has it", async () => {
  const post = vi.fn().mockResolvedValue("recorded");
  const activation = createActivation(post);
  activation.know();
  expect(await activation.activate("a")).toBe("known");
  expect(post).not.toHaveBeenCalled();
});

it("keeps posting after a failure or an unchanged answer", async () => {
  const post = vi
    .fn()
    .mockResolvedValueOnce("failed")
    .mockResolvedValueOnce("unchanged")
    .mockResolvedValueOnce("recorded");
  const activation = createActivation(post);
  expect(await activation.activate("a")).toBe("failed");
  expect(await activation.activate("a")).toBe("unchanged");
  expect(await activation.activate("a")).toBe("recorded");
  expect(post).toHaveBeenCalledTimes(3);
});
