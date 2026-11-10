import { describe, expect, it, vi } from "vitest";
import { FREE_ALLOWANCE } from "@spark/core";
import { draftStore } from "./drafts";
import { Refused, type Upload } from "./image-capture";
import {
  libraryActions,
  type Memory,
  type Transport,
  type WallMemory,
} from "./library-actions";

// Image Capture's per-Memory state machine against a fake server. Decoding
// needs a browser, so prepareImage is faked; the Free allowance check is real.
vi.mock("@spark/capture", async (original) => ({
  ...(await original<object>()),
  prepareImage: async (file: File) => ({
    file,
    mime: "image/png",
    width: 400,
    height: 300,
    contentHash: "0".repeat(64),
    thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
    thumbnail: new Blob([new Uint8Array(4)], { type: "image/webp" }),
    thumbnailMime: "image/webp",
  }),
}));

const settle = () => new Promise((r) => setTimeout(r, 0));
const png = (bytes = 8) =>
  new File([new Uint8Array(bytes)], "shot.png", { type: "image/png" });

/** A promise the test resolves or rejects by hand. */
function later<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
}

const uploads: Upload[] = [
  { role: "original", url: "/o", headers: {} },
  { role: "thumbnail", url: "/t", headers: {} },
];

const serverCopy = (id: string): Memory => ({
  id,
  kind: "image",
  title: null,
  body: null,
  captureNote: null,
  preservation: "preserved",
  indexState: "indexing",
  revision: 1,
  capturedAt: "2026-11-10T10:00:00.000Z",
  updatedAt: "2026-11-10T10:00:00.000Z",
  image: {
    url: "https://r2/original",
    thumbnailUrl: "https://r2/thumbnail",
    mime: "image/png",
    bytes: 8,
    width: 400,
    height: 300,
    thumbhash: "x",
  },
});

function setup(transport: Partial<Transport> = {}) {
  let wall: WallMemory[] = [];
  const notify = vi.fn();
  const calls: string[] = [];
  const full: Transport = {
    create: vi.fn(),
    patch: vi.fn(),
    get: vi.fn(),
    remove: vi.fn(async (id) => void calls.push(`remove ${id}`)),
    storage: async () => ({ usedBytes: 0 }),
    createImage: vi.fn(async (input) => {
      calls.push(`create ${input.id}`);
      return { memory: serverCopy(input.id), uploads };
    }),
    put: vi.fn(async (u, body, onProgress) => onProgress(body.size)),
    confirm: vi.fn(async (id) => {
      calls.push(`confirm ${id}`);
      return serverCopy(id);
    }),
    ...transport,
  };
  const actions = libraryActions({
    setMemories: (update) => {
      wall = typeof update === "function" ? update(wall) : update;
    },
    transport: full,
    drafts: draftStore(undefined),
    notify: notify as never,
    onSaved: vi.fn(),
  });
  return { actions, wall: () => wall, notify, calls, transport: full };
}

function toastAction(notify: ReturnType<typeof vi.fn>, label: string) {
  const call = notify.mock.calls.findLast(
    ([, options]) => options?.action?.label === label
  );
  if (!call) throw new Error(`no toast offered ${label}`);
  return call[1].action.onClick as () => void;
}

describe("image Capture", () => {
  it("lands at once, uploads, and becomes the server's copy without losing the local files", async () => {
    const { actions, wall, calls } = setup();
    await actions.captureImages([png()]);
    const [landed] = wall();
    expect(landed).toMatchObject({ kind: "image", fresh: true });
    expect(landed!.image!.url).toMatch(/^blob:/);
    await settle();
    const [now] = wall();
    expect(now!.upload).toBeUndefined();
    expect(now!.image!.url).toBe(landed!.image!.url);
    expect(calls).toEqual([`create ${landed!.id}`, `confirm ${landed!.id}`]);
  });

  it("shows a failed upload on its tile, and Try Again resends the same Memory", async () => {
    const put = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const { actions, wall, notify, transport } = setup({ put });
    await actions.captureImages([png()]);
    await settle();
    expect(wall()[0]!.upload).toEqual({ step: "failed" });

    const tryAgain = toastAction(notify, "Try Again");
    tryAgain();
    tryAgain(); // a second click while it runs starts nothing
    expect(wall()[0]!.upload).toMatchObject({ step: "sending" });
    await settle();
    expect(wall()[0]!.upload).toBeUndefined();
    const ids = vi.mocked(transport.createImage).mock.calls.map(([i]) => i.id);
    expect(ids).toEqual([wall()[0]!.id, wall()[0]!.id]);
  });

  it("Undo during an upload stops it, and the delete waits for the create in flight", async () => {
    const created = later<{ memory: Memory; uploads: Upload[] }>();
    const calls: string[] = [];
    const { actions, wall, notify } = setup({
      createImage: () => created.promise,
      remove: async (id) => void calls.push(`remove ${id}`),
    });
    await actions.captureImages([png()]);
    const id = wall()[0]!.id;
    toastAction(notify, "Undo")();
    expect(wall()).toEqual([]);
    expect(calls).toEqual([]);
    created.resolve({ memory: serverCopy(id), uploads });
    await settle();
    expect(calls).toEqual([`remove ${id}`]);
    expect(wall()).toEqual([]);
  });

  it("a delete while uploading takes the tile away at once, with no Undo", async () => {
    const confirmed = later<Memory>();
    const { actions, wall, notify, calls } = setup({
      confirm: () => confirmed.promise,
    });
    await actions.captureImages([png()]);
    await settle();
    const memory = wall()[0]!;
    actions.remove(memory);
    expect(wall()).toEqual([]);
    expect(notify).toHaveBeenLastCalledWith("Deleted");
    confirmed.resolve(serverCopy(memory.id));
    await settle();
    expect(calls.at(-1)).toBe(`remove ${memory.id}`);
    expect(wall()).toEqual([]);
  });

  it("refuses up front a file over 25 MB and one beyond the storage left", async () => {
    const { actions, wall, notify, transport } = setup({
      storage: async () => ({
        usedBytes: FREE_ALLOWANCE.storageBytes - 100,
      }),
    });
    const big = png(FREE_ALLOWANCE.maxUploadBytes + 1);
    await actions.captureImages([big, png(60), png(60)]);
    expect(notify).toHaveBeenCalledWith(
      "Images Over 25 MB Can't Be Captured",
      expect.anything()
    );
    expect(notify).toHaveBeenCalledWith(
      "Your 1 GB Free Allowance Is Full",
      expect.anything()
    );
    expect(wall()).toHaveLength(1);
    await settle();
    expect(transport.createImage).toHaveBeenCalledTimes(1);
  });

  it("takes the tile away with the reason when the server refuses it", async () => {
    const { actions, wall, notify } = setup({
      createImage: async () => {
        throw new Refused("storage_full");
      },
    });
    await actions.captureImages([png()]);
    await settle();
    expect(wall()).toEqual([]);
    expect(notify).toHaveBeenCalledWith(
      "Your 1 GB Free Allowance Is Full",
      expect.anything()
    );
  });

  it("stops the other file when one fails, so no upload outlives its run", async () => {
    let signal: AbortSignal | undefined;
    const { actions, wall } = setup({
      put: (u, _body, _progress, s) =>
        u.role === "original"
          ? new Promise((_, reject) => {
              signal = s;
              s.addEventListener("abort", () => reject(new Error("aborted")));
            })
          : Promise.reject(new Error("offline")),
    });
    await actions.captureImages([png()]);
    await settle();
    expect(signal?.aborted).toBe(true);
    expect(wall()[0]!.upload).toEqual({ step: "failed" });
  });

  it("reports progress across both files", async () => {
    const sent = later();
    const progress: number[] = [];
    const { actions, wall } = setup({
      put: async (u, body, onProgress) => {
        if (u.role === "original") {
          onProgress(body.size / 2);
          progress.push((wall()[0]!.upload as { progress: number }).progress);
          await sent.promise;
        }
        onProgress(body.size);
      },
    });
    await actions.captureImages([png(8)]);
    await settle();
    // 4 of 12 bytes (8 original + 4 thumbnail), then the thumbnail's 4.
    expect(progress[0]).toBeCloseTo(4 / 12);
    expect(wall()[0]!.upload).toEqual({ step: "sending", progress: 8 / 12 });
    sent.resolve();
    await settle();
    expect(wall()[0]!.upload).toBeUndefined();
  });
});
