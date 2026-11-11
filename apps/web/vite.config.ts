import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// SPARK_WEB_PORT and SPARK_API_PORT let a second checkout run beside the first.
const env = process.env;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(env.SPARK_WEB_PORT ?? 5173),
    strictPort: true,
    // In dev the API runs in `wrangler dev`; in prod the Worker serves both.
    proxy: { "/api": `http://localhost:${env.SPARK_API_PORT ?? 8787}` },
  },
});
