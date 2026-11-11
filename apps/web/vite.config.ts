import { defineConfig, type Plugin } from "vite";
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

export default defineConfig({
  plugins: [react(), tailwindcss(), heicChunkAllowance()],
  server: {
    port: Number(env.SPARK_WEB_PORT ?? 5173),
    strictPort: true,
    // In dev the API runs in `wrangler dev`; in prod the Worker serves both.
    proxy: { "/api": `http://localhost:${env.SPARK_API_PORT ?? 8787}` },
  },
});
