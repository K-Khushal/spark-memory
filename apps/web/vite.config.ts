import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // In dev the API runs in `wrangler dev`; in prod the Worker serves both.
    proxy: { "/api": "http://localhost:8787" },
  },
});
