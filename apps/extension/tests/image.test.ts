import { expect, it, vi } from "vitest";
import { fetchImage } from "../lib/image";
it("fetches image bytes without page credentials or redirects", async () => {
  const request = vi.fn().mockResolvedValue(
    new Response(new Uint8Array([1, 2]), {
      headers: { "content-type": "image/png" },
    })
  );
  const image = await fetchImage("https://images.test/photo", request);
  expect(image.type).toBe("image/png");
  expect(await image.arrayBuffer()).toEqual(new Uint8Array([1, 2]).buffer);
  expect(request).toHaveBeenCalledWith(
    "https://images.test/photo",
    expect.objectContaining({ credentials: "omit", redirect: "error" })
  );
});
it("rejects non-web image Sources without fetching", async () => {
  const request = vi.fn();
  await expect(fetchImage("file:///private", request)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
