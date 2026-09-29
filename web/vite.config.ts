import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: { include: ["src/**/*.test.ts"] },
  // `node server/server.mjs` (PORT=8787) serves /api locally; the app calls it through this proxy.
  server: { proxy: { "/api": "http://127.0.0.1:8787" } },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: { manualChunks: (id) => (id.includes("maplibre-gl") ? "maplibre" : undefined) },
    },
  },
});
