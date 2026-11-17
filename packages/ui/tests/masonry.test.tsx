/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Masonry, type MasonrySelection } from "../index";

let host: HTMLElement;
let root: Root;
/** A stand-in for a running Animation: enough for the wall to retarget it. */
const fakeAnimation = () => ({
  cancel: vi.fn(),
  addEventListener: vi.fn(),
});
const animate = vi.fn((..._args: unknown[]) => fakeAnimation());

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  // happy-dom lays nothing out: a 4-lane wall, 220px a lane, 100px tiles.
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 940,
  });
  Object.assign(HTMLElement.prototype, { animate });
  animate.mockClear();
  animate.mockImplementation(() => fakeAnimation());
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
  Reflect.deleteProperty(HTMLElement.prototype, "animate");
});

type Item = { id: string };
const items = (ids: string[]): Item[] => ids.map((id) => ({ id }));

function wall(
  list: Item[],
  extra: { glideKey?: string; selection?: MasonrySelection } = {}
): ReactNode {
  return (
    <Masonry
      items={list}
      getKey={(item) => item.id}
      getLabel={(item) => item.id}
      getHeight={() => 100}
      label="Wall"
      glide={false}
      renderItem={(item) => <span>{item.id}</span>}
      {...extra}
    />
  );
}
const render = (node: ReactNode) => act(async () => root.render(node));
const tile = (id: string) =>
  host.querySelector<HTMLElement>(`[data-key="${id}"]`)!;

it("a Capture at the front glides the tiles that moved and enters the new one", async () => {
  const before = items(["a", "b", "c", "d", "e", "f"]);
  await render(wall(before, { glideKey: "library" }));
  expect(animate).not.toHaveBeenCalled();
  const moved = tile("a").style.transform;

  await render(wall([{ id: "new" }, ...before], { glideKey: "library" }));
  // Every old tile took a new place; each glides from its old one.
  const gliding = animate.mock.calls.filter(
    ([frames]) => Array.isArray(frames) && "transform" in (frames[0] as object)
  );
  expect(gliding.length).toBeGreaterThanOrEqual(4);
  expect(tile("a").style.transform).not.toBe(moved);
  expect(gliding[0]![1]).toMatchObject({ duration: 180 });
  // Only the tile new to the wall enters (260ms fade and scale, by CSS).
  expect(tile("new").dataset.enter).toBe("true");
  expect(tile("a").dataset.enter).toBeUndefined();
});

it("an update that lands mid-glide retargets from where the tile is drawn and cancels the old glide", async () => {
  const before = items(["a", "b", "c", "d", "e", "f"]);
  await render(wall(before, { glideKey: "library" }));
  await render(wall([{ id: "n1" }, ...before], { glideKey: "library" }));
  const superseded = animate.mock.results.find(
    (_, i) =>
      (animate.mock.calls[i]![0] as { transform: string }[])[1]!.transform ===
      tile("a").style.transform
  )!.value as ReturnType<typeof fakeAnimation>;
  expect(superseded).toBeDefined();
  animate.mockClear();

  // 60ms later the tile is drawn part-way between its old place and the new.
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation(((
    node: Element,
    pseudo?: string | null
  ) => {
    const style = real(node, pseudo);
    return (node as HTMLElement).dataset?.key === "a"
      ? new Proxy(style, {
          get: (target, prop) =>
            prop === "transform"
              ? "matrix(1, 0, 0, 1, 40, 25)"
              : Reflect.get(target, prop),
        })
      : style;
  }) as typeof window.getComputedStyle);
  await render(
    wall([{ id: "n2" }, { id: "n1" }, ...before], { glideKey: "library" })
  );

  const second = animate.mock.calls
    .map(([frames]) => frames as { transform: string }[])
    .filter((frames) => frames[1]!.transform === tile("a").style.transform);
  expect(second).toHaveLength(1);
  // Starts at the sampled mid position, not at the previous destination.
  expect(second[0]![0]!.transform).toBe("translate(40px, 25px)");
  expect(superseded.cancel).toHaveBeenCalled();
  vi.restoreAllMocks();
});

it("a removal glides the neighbours and nothing enters", async () => {
  const before = items(["a", "b", "c", "d", "e", "f"]);
  await render(wall(before, { glideKey: "library" }));
  await render(wall(before.slice(1), { glideKey: "library" }));
  expect(animate).toHaveBeenCalled();
  expect(host.querySelector("[data-enter]")).toBeNull();
});

it("a different glideKey (a filter or query) never glides or enters", async () => {
  const before = items(["a", "b", "c", "d"]);
  await render(wall(before, { glideKey: "one" }));
  await render(wall([{ id: "new" }, ...before], { glideKey: "two" }));
  expect(animate).not.toHaveBeenCalled();
  expect(host.querySelector("[data-enter]")).toBeNull();
});

it("the first fill of an empty wall is not an entrance", async () => {
  await render(wall([], { glideKey: "library" }));
  await render(wall(items(["a", "b", "c"]), { glideKey: "library" }));
  expect(animate).not.toHaveBeenCalled();
  expect(host.querySelector("[data-enter]")).toBeNull();
});

it("reduced motion removes the glide and the entrance", async () => {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) => ({ matches: /reduce/.test(query) }) as MediaQueryList
  );
  const before = items(["a", "b", "c", "d"]);
  await render(wall(before, { glideKey: "library" }));
  await render(wall([{ id: "new" }, ...before], { glideKey: "library" }));
  expect(animate).not.toHaveBeenCalled();
  expect(host.querySelector("[data-enter]")).toBeNull();
  vi.restoreAllMocks();
});

it("Select All on 10,000 Memories looks each tile up in constant time", async () => {
  const all = items(Array.from({ length: 10_000 }, (_, i) => `m${i}`));
  const ids = all.map((item) => item.id);
  // Count scans of the selected ids themselves.
  let scans = 0;
  const original = Array.prototype.includes;
  Array.prototype.includes = function (this: unknown[], ...args: [unknown]) {
    if (this === ids) scans++;
    return original.apply(this, args);
  };
  const selection = (selected: string[]): MasonrySelection => ({
    ids: selected,
    choose: () => {},
    all: () => {},
    clear: () => {},
    marquee: () => {},
  });
  await render(wall(all, { selection: selection([]) }));
  const start = performance.now();
  await render(wall(all, { selection: selection(ids) }));
  const took = performance.now() - start;
  // A scan per rendered tile would make this 10,000 × tiles comparisons.
  Array.prototype.includes = original;
  expect(scans).toBe(0);
  expect(took).toBeLessThan(1500);
  const selected = host.querySelectorAll("[data-selected]");
  expect(selected.length).toBeGreaterThan(0);
  expect(host.querySelector("[data-selection-active=true]")).not.toBeNull();
});

it("lays out 10k items with estimates and bounds synchronous precise heights to the viewport window", async () => {
  const callbacks: IdleRequestCallback[] = [];
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  vi.stubGlobal("cancelIdleCallback", vi.fn());
  const precise = vi.fn(() => 120);
  const list = items(
    Array.from({ length: 10_000 }, (_, i) => `progressive-${i}`)
  );
  await render(
    <Masonry
      items={list}
      getKey={(item) => item.id}
      getLabel={(item) => item.id}
      estimateHeight={() => 140}
      getHeight={precise}
      label="Progressive"
      renderItem={(item) => <span>{item.id}</span>}
    />
  );
  expect(precise.mock.calls.length).toBeGreaterThan(0);
  expect(precise.mock.calls.length).toBeLessThanOrEqual(200);
  expect(callbacks.length).toBeGreaterThan(0);
});

it("precise heights yield in idle chunks and obsolete wall work is cancelled", async () => {
  const callbacks: IdleRequestCallback[] = [];
  const cancel = vi.fn();
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  vi.stubGlobal("cancelIdleCallback", cancel);
  let time = 0;
  vi.spyOn(performance, "now").mockImplementation(() => time);
  const precise = vi.fn(() => {
    time += 2;
    return 120;
  });
  const list = items(Array.from({ length: 10_000 }, (_, i) => `idle-${i}`));
  await render(
    <Masonry
      items={list}
      getKey={(item) => item.id}
      getLabel={(item) => item.id}
      estimateHeight={() => 140}
      getHeight={precise}
      label="Idle"
      renderItem={(item) => <span>{item.id}</span>}
    />
  );
  const initial = precise.mock.calls.length;
  // Cached viewport items may consume the first callbacks without shaping.
  for (let chunk = 0; chunk < 10; chunk++) {
    const started = time;
    const calls = precise.mock.calls.length;
    await act(async () => {
      callbacks.shift()!({ didTimeout: false, timeRemaining: () => 50 });
    });
    expect(time - started).toBeLessThanOrEqual(8);
    expect(precise.mock.calls.length - calls).toBeLessThanOrEqual(3);
  }
  expect(precise.mock.calls.length).toBeGreaterThan(initial);
  await render(null);
  expect(cancel).toHaveBeenCalled();
  const stopped = precise.mock.calls.length;
  callbacks.shift()!({ didTimeout: true, timeRemaining: () => 50 });
  expect(precise).toHaveBeenCalledTimes(stopped);
});
