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
    palette: ["#ff8800"],
    thumbnail: new Blob([new Uint8Array(4)], { type: "image/webp" }),
    thumbnailMime: "image/webp",
  }),
  preparePdf: async (file: File) => ({
    file,
    contentHash: "1".repeat(64),
    title: file.name.replace(/\.pdf$/, ""),
    pages: 40,
    width: 1024,
    height: 1325,
    thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
    palette: [],
    thumbnail: new Blob([new Uint8Array(4)], { type: "image/webp" }),
    thumbnailMime: "image/webp",
    pageImages: pdfPages.draw,
    release: pdfPages.release,
  }),
}));

/** How the faked PDF draws its pages, per test. */
const pdfPages = {
  draw: vi.fn(async () =>
    [1, 2].map((n) => ({
      blob: new Blob([new Uint8Array(10 + n)], { type: "image/jpeg" }),
      width: 1024,
      height: 1325,
    }))
  ),
  release: vi.fn(),
};
const pdfFile = () =>
  new File([new Uint8Array(20)], "Lease.pdf", { type: "application/pdf" });

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
  pages: null,
  body: null,
  captureNote: null,
  preservation: "preserved",
  indexState: "indexing",
  indexError: null,
  indexTitle: null,
  sample: false,
  aiOptOut: false,
  hasVectors: false,
  deepFetch: null,
  revision: 1,
  capturedAt: "2026-11-10T10:00:00.000Z",
  lastSavedAt: "2026-11-10T10:00:00.000Z",
  sourceUrl: null,
  pageTitle: null,
  description: null,
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
    createLink: vi.fn(),
    createPdf: vi.fn(),
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
    preload: async () => {},
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
  it("lands at once, uploads, and keeps the local files on screen until the stored ones load, then frees them", async () => {
    const loaded = later();
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const { actions, wall, calls } = setup({ preload: () => loaded.promise });
    await actions.captureFiles([png()]);
    const [landed] = wall();
    expect(landed).toMatchObject({ kind: "image", fresh: true });
    expect(landed!.image!.url).toMatch(/^blob:/);
    await settle();
    const [stored] = wall();
    expect(stored!.upload).toBeUndefined();
    expect(stored!.image!.url).toBe(landed!.image!.url);
    expect(calls).toEqual([`create ${landed!.id}`, `confirm ${landed!.id}`]);
    expect(revoke).not.toHaveBeenCalled();

    loaded.resolve();
    await settle();
    expect(wall()[0]!.image).toMatchObject({
      url: "https://r2/original",
      thumbnailUrl: "https://r2/thumbnail",
    });
    expect(revoke).toHaveBeenCalledWith(landed!.image!.url);
    expect(revoke).toHaveBeenCalledWith(landed!.image!.thumbnailUrl);
    revoke.mockRestore();
  });

  it("Undo right after a confirm does not wait for the thumbnail to load", async () => {
    const loaded = later();
    let removed = false;
    const { actions, wall, notify, calls } = setup({
      preload: () => loaded.promise,
      remove: async (id) => {
        removed = true;
        calls.push(`remove ${id}`);
      },
    });
    await actions.captureFiles([png()]);
    await settle();
    const id = wall()[0]!.id;
    expect(wall()[0]!.image!.url).toMatch(/^blob:/);
    toastAction(notify, "Undo")();
    await settle();
    expect(removed).toBe(true);
    expect(calls).toContain(`remove ${id}`);
    expect(wall()).toEqual([]);
    loaded.resolve();
    await settle();
    expect(wall()).toEqual([]);
  });

  it("shows a failed upload on its tile, and Try Again resends the same Memory", async () => {
    const put = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const { actions, wall, notify, transport } = setup({ put });
    await actions.captureFiles([png()]);
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
    await actions.captureFiles([png()]);
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
    await actions.captureFiles([png()]);
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
    await actions.captureFiles([big, png(60), png(60)]);
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

  it.each([
    ["storage_full", "Your 1 GB Free Allowance Is Full"],
    // e.g. a 400 for something the browser made that the server won't take:
    // no Failed tile that Try Again could never fix.
    ["invalid", "Image Can't Be Captured"],
  ] as const)(
    "takes the tile away with the reason when the server refuses it (%s)",
    async (reason, message) => {
      const { actions, wall, notify } = setup({
        createImage: async () => {
          throw new Refused(reason);
        },
      });
      await actions.captureFiles([png()]);
      await settle();
      expect(wall()).toEqual([]);
      expect(notify).toHaveBeenCalledWith(message, expect.anything());
    }
  );

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
    await actions.captureFiles([png()]);
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
    await actions.captureFiles([png(8)]);
    await settle();
    // 4 of 12 bytes (8 original + 4 thumbnail), then the thumbnail's 4.
    expect(progress[0]).toBeCloseTo(4 / 12);
    expect(wall()[0]!.upload).toEqual({ step: "sending", progress: 8 / 12 });
    sent.resolve();
    await settle();
    expect(wall()[0]!.upload).toBeUndefined();
  });
});

describe("Capture from a share", () => {
  const held = (id: string, bytes = 8) => ({ id, file: png(bytes) });

  it("keeps the ids it was given, and is stored only when the server has the files", async () => {
    const sent = later();
    const { actions, wall, calls } = setup({
      put: async () => sent.promise,
    });
    const id = crypto.randomUUID();
    let outcome: string | undefined;
    void actions
      .captureSharedFiles([held(id)])
      .then(([first]) => (outcome = first));
    await settle();
    expect(wall()[0]!.id).toBe(id);
    expect(calls).toEqual([`create ${id}`]);
    expect(outcome).toBeUndefined(); // landed, uploading: not done
    sent.resolve();
    await settle();
    expect(calls).toEqual([`create ${id}`, `confirm ${id}`]);
    expect(outcome).toBe("stored");
  });

  it("stays open through a failed upload, and ends when Try Again finishes it", async () => {
    const put = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const { actions, notify } = setup({ put });
    let outcome: string | undefined;
    void actions
      .captureSharedFiles([held(crypto.randomUUID())])
      .then(([first]) => (outcome = first));
    await settle();
    expect(outcome).toBeUndefined();
    toastAction(notify, "Try Again")();
    await settle();
    expect(outcome).toBe("stored");
  });

  it("ends as dropped when Undo takes the Capture back", async () => {
    const sent = later();
    const { actions, notify } = setup({ put: async () => sent.promise });
    let outcome: string | undefined;
    void actions
      .captureSharedFiles([held(crypto.randomUUID())])
      .then(([first]) => (outcome = first));
    await settle();
    toastAction(notify, "Undo")();
    await settle();
    expect(outcome).toBe("dropped");
  });

  it("ends as refused for a file the Free allowance turns away", async () => {
    const { actions } = setup();
    const outcomes = await actions.captureSharedFiles([
      held(crypto.randomUUID(), FREE_ALLOWANCE.maxUploadBytes + 1),
    ]);
    expect(outcomes).toEqual(["refused"]);
  });

  it("replays a held share without charging its own reservation again", async () => {
    // The server's count already includes this image's pending upload.
    const nearlyFull = FREE_ALLOWANCE.storageBytes - 4;
    const { actions, calls } = setup({
      storage: async () => ({ usedBytes: nearlyFull }),
    });
    const id = crypto.randomUUID();
    expect(await actions.captureSharedFiles([held(id)])).toEqual(["stored"]);
    expect(calls).toEqual([`create ${id}`, `confirm ${id}`]);
  });

  it("keeps a share when the server says the account is full", async () => {
    const createImage = vi.fn(async () => {
      throw new Refused("storage_full");
    });
    const { actions, notify } = setup({ createImage });
    const outcomes = await actions.captureSharedFiles([
      held(crypto.randomUUID()),
    ]);
    expect(outcomes).toEqual(["full"]);
    expect(notify).toHaveBeenCalledWith(
      "Your 1 GB Free Allowance Is Full",
      expect.anything()
    );
  });

  it("sends the same id again when the same share comes back", async () => {
    const { actions, transport } = setup();
    const id = crypto.randomUUID();
    await actions.captureSharedFiles([held(id)]);
    await actions.captureSharedFiles([held(id)]);
    const ids = vi.mocked(transport.createImage).mock.calls.map(([i]) => i.id);
    expect(ids).toEqual([id, id]);
  });

  describe("text and links", () => {
    it("is stored when the server's create answers, under the share's id", async () => {
      const made = later<Memory>();
      const create = vi.fn(() => made.promise);
      const { actions, transport } = setup({ create });
      const id = crypto.randomUUID();
      let outcome: string | undefined;
      void actions.captureShared("Lemon tart", id).then((o) => (outcome = o));
      await settle();
      expect(outcome).toBeUndefined();
      made.resolve({ ...serverCopy(id), kind: "text", image: null });
      await settle();
      expect(outcome).toBe("stored");
      expect(transport.create).toHaveBeenCalledWith(
        expect.objectContaining({ id, body: "Lemon tart" })
      );
    });

    it("stays open when the request fails, and ends when Try Again lands", async () => {
      const create = vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockImplementation(async (input: { id: string }) => ({
          ...serverCopy(input.id),
          kind: "text",
          image: null,
        }));
      const { actions, notify } = setup({ create });
      let outcome: string | undefined;
      void actions
        .captureShared("Lemon tart", "id-1")
        .then((o) => (outcome = o));
      await settle();
      expect(outcome).toBeUndefined();
      toastAction(notify, "Try Again")();
      await settle();
      expect(outcome).toBe("stored");
      expect(create.mock.calls.map(([i]) => i.id)).toEqual(["id-1", "id-1"]);
    });

    it("sends a link under the share's id, and a page saved before still ends it", async () => {
      const createLink = vi.fn(async () => ({
        ...serverCopy("saved-earlier"),
        kind: "link" as const,
        image: null,
      }));
      const { actions } = setup({ createLink });
      const outcome = await actions.captureShared(
        "https://example.com",
        "id-2"
      );
      expect(outcome).toBe("stored");
      expect(createLink).toHaveBeenCalledWith(
        expect.objectContaining({ id: "id-2", url: "https://example.com" })
      );
    });

    it("is refused, not stored, when the text is empty or too long", async () => {
      const { actions } = setup();
      expect(await actions.captureShared("   ", "id-3")).toBe("refused");
      expect(
        await actions.captureShared(
          "a".repeat(FREE_ALLOWANCE.textMaxChars + 1),
          "id-4"
        )
      ).toBe("refused");
    });

    it("ends as dropped when Undo takes it back", async () => {
      const made = later<Memory>();
      const { actions, notify } = setup({ create: () => made.promise });
      let outcome: string | undefined;
      void actions.captureShared("Oops", "id-5").then((o) => (outcome = o));
      await settle();
      toastAction(notify, "Undo")();
      await settle();
      expect(outcome).toBe("dropped");
    });
  });
});

describe("PDF Capture", () => {
  const pdfUploads: Upload[] = [
    { role: "original", page: 0, url: "/o", headers: {} },
    { role: "thumbnail", page: 0, url: "/t", headers: {} },
    { role: "page", page: 1, url: "/p1", headers: {} },
    { role: "page", page: 2, url: "/p2", headers: {} },
  ];

  it("lands at once, draws its pages, then uploads each to its own URL", async () => {
    const sent: [string, number][] = [];
    const createPdf = vi.fn(async (input: { id: string }) => ({
      memory: { ...serverCopy(input.id), kind: "pdf" as const, pages: 40 },
      uploads: pdfUploads,
    }));
    const { actions, wall } = setup({
      createPdf,
      put: vi.fn(async (u, body, onProgress) => {
        sent.push([u.url, body.size]);
        onProgress(body.size);
      }),
    });
    await actions.captureFiles([pdfFile()]);
    expect(wall()[0]).toMatchObject({
      kind: "pdf",
      title: "Lease",
      pages: 40,
      image: { mime: "application/pdf" },
      upload: { step: "sending" },
    });
    await settle();
    expect(createPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Lease",
        pages: 40,
        pageImages: [
          { bytes: 11, width: 1024, height: 1325 },
          { bytes: 12, width: 1024, height: 1325 },
        ],
      })
    );
    expect(sent).toEqual([
      ["/o", 20],
      ["/t", 4],
      ["/p1", 11],
      ["/p2", 12],
    ]);
    expect(wall()[0]!.upload).toBeUndefined();
  });

  it("takes a PDF whose pages cannot be drawn off the wall, and says so", async () => {
    pdfPages.draw.mockRejectedValueOnce("unreadable");
    const createPdf = vi.fn();
    const { actions, wall, notify } = setup({ createPdf });
    await actions.captureFiles([pdfFile()]);
    await settle();
    expect(wall()).toEqual([]);
    expect(createPdf).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("PDF Can't Be Read", expect.anything());
    expect(pdfPages.release).toHaveBeenCalled();
  });

  it("refuses a PDF over the upload limit before any work", async () => {
    const { actions, wall, notify } = setup();
    const big = new File([new Uint8Array(1)], "big.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(big, "size", {
      value: FREE_ALLOWANCE.maxUploadBytes + 1,
    });
    await actions.captureFiles([big]);
    expect(wall()).toEqual([]);
    expect(notify).toHaveBeenCalledWith(
      "PDFs Over 25 MB Can't Be Captured",
      expect.anything()
    );
  });
});
