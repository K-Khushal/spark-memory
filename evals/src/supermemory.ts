// `pnpm --filter @spark/evals compare:supermemory --yes`: ADR-0009's benchmark.
// Uploads the sample Library (openly licensed, nothing of a user's) to a
// fresh Supermemory namespace, asks every search, scores it exactly like
// Spark, and removes the namespace. Spends the owner's Supermemory credits and
// calls an outside service, so it needs SUPERMEMORY_API_KEY and --yes, and
// never runs in CI. Endpoints are from https://supermemory.ai/docs (November
// 2026): POST /ns/{ns}/document, POST /ns/{ns}/document/file,
// GET /ns/{ns}/document/{id}, POST /ns/{ns}/search, and the namespace-wide
// removal at the end. Search results carry the metadata sent with a document;
// that is how a result is mapped back to a sample Library id.
import { loadSet, readLibraryFile } from "./manifest";
import type { SearchOutcome } from "./run";
import { formatReport } from "./score";

const apiKey = process.env.SUPERMEMORY_API_KEY;
if (!process.argv.includes("--yes") || !apiKey) {
  console.error(
    "usage: SUPERMEMORY_API_KEY=... compare:supermemory --yes   (calls Supermemory, uses its credits)"
  );
  process.exit(2);
}

const BASE = "https://api.supermemory.ai";
const namespace = `spark-evals-${crypto.randomUUID().slice(0, 8)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${BASE}/ns/${namespace}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, ...init.headers },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(
      `Supermemory ${init.method ?? "GET"} ${path.split("?")[0]} answered ${res.status}`
    );
  }
  return res.status === 204 ? undefined : res.json();
}
const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const set = await loadSet();
const ids: string[] = [];
try {
  for (const item of set.items) {
    const metadata = { memoryId: item.id };
    let reply;
    if (item.kind === "text") {
      const text = (await readLibraryFile(item.text!)).toString("utf8");
      const content = `${item.title ?? ""}\n\n${text}`;
      reply = await call("/document", json({ content, metadata }));
    } else {
      const form = new FormData();
      const bytes = new Uint8Array(await readLibraryFile(item.file!));
      form.set(
        "file",
        new Blob([bytes], { type: item.image!.mime }),
        item.file!.split("/").pop()
      );
      form.set("metadata", JSON.stringify(metadata));
      reply = await call("/document/file", { method: "POST", body: form });
    }
    ids.push((reply as { id: string }).id);
  }
  // Processing is asynchronous: wait until every document is searchable.
  for (let waited = 0; waited < 600; waited += 5) {
    const states = await Promise.all(
      ids.map(
        async (id) =>
          ((await call(`/document/${id}`)) as { system: { status: string } })
            .system.status
      )
    );
    if (states.includes("failed")) {
      throw new Error("Supermemory failed to process a document");
    }
    if (states.every((s) => s === "done")) break;
    await sleep(5000);
  }

  const outcomes: SearchOutcome[] = [];
  for (const c of set.searches) {
    const { results } = (await call(
      "/search",
      json({ query: c.query, searchMode: "hybrid", limit: 40, threshold: 0 })
    )) as { results: { metadata?: { memoryId?: string } }[] };
    // Several chunks can come from one document: keep each document's best.
    const order = [
      ...new Set(
        results.map((r) => r.metadata?.memoryId).filter((m): m is string => !!m)
      ),
    ];
    const at = order.findIndex((id) => c.expect.includes(id));
    outcomes.push({
      id: c.id,
      kind: c.kind,
      query: c.query,
      rank: at < 0 ? null : at + 1,
      top: order.slice(0, 5),
      matchedBy: [],
      fellBack: false,
    });
  }
  console.log(
    formatReport({
      memories: set.items.length,
      searches: outcomes,
      costMicros: 0,
    })
  );
} finally {
  await call("", { method: "DELETE" }).catch(() =>
    console.error(`remove namespace ${namespace} by hand`)
  );
}
