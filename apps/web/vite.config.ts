import { fileURLToPath } from "node:url";
import { build, defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// SPARK_WEB_PORT and SPARK_API_PORT let a second checkout run beside the first.
const env = process.env;

/** heic-to is already lazy (~3.2 MB) and only loads on HEIC Capture. */
const HEIC_CHUNK_LIMIT_KB = 4_000;
const CHUNK_LIMIT_KB = 500;

function heicChunkAllowance(): Plugin {
  return {
    name: "heic-chunk-allowance",
    config: () => ({
      build: { chunkSizeWarningLimit: HEIC_CHUNK_LIMIT_KB },
    }),
    generateBundle(_opts, bundle) {
      for (const [file, item] of Object.entries(bundle)) {
        if (item.type !== "chunk" || file.includes("heic-to")) continue;
        const kb = item.code.length / 1024;
        if (kb > CHUNK_LIMIT_KB) {
          this.warn(
            `${file} is ${kb.toFixed(2)} kB (limit ${CHUNK_LIMIT_KB} kB)`
          );
        }
      }
    },
  };
}

const SW_SRC = fileURLToPath(new URL("./src/pwa/sw.ts", import.meta.url));

/** Bundles the worker (it imports the hold and the cache policy). */
async function buildSw(version: string): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    publicDir: false,
    define: { __SPARK_SW_VERSION__: JSON.stringify(version) },
    build: {
      write: false,
      minify: true,
      lib: { entry: SW_SRC, formats: ["es"], fileName: "sw" },
    },
  });
  const [bundle] = Array.isArray(result) ? result : [result];
  if (!bundle || !("output" in bundle)) throw new Error("Service worker build");
  return bundle.output[0].code;
}

/** Serves /sw.js in dev and emits it, versioned per build, next to the app. */
function sparkSw(): Plugin {
  return {
    name: "spark-sw",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== "/sw.js") return next();
        buildSw("dev").then((code) => {
          res.setHeader("Content-Type", "application/javascript");
          res.setHeader("Cache-Control", "no-cache");
          res.end(code);
        }, next);
      });
    },
    async generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: await buildSw(Date.now().toString(36)),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), heicChunkAllowance(), sparkSw()],
  // Found only when the first PDF is Captured: optimised up front, so the
  // dev server does not reload the page mid-Capture to add it.
  optimizeDeps: { include: ["@spark/capture > pdfjs-dist"] },
  server: {
    port: Number(env.SPARK_WEB_PORT ?? 5173),
    strictPort: true,
    // In dev the API runs in `wrangler dev`; in prod the Worker serves both.
    proxy: {
      "/api": `http://localhost:${env.SPARK_API_PORT ?? 8787}`,
      "/.well-known": `http://localhost:${env.SPARK_API_PORT ?? 8787}`,
    },
  },
});
