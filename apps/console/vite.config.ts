import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

import { liveViewPlugin, validateWorldSource } from "../../tooling/features/live-view/live-view.ts";

const worldSource = validateWorldSource(process.env.ARTI_WORLD_SOURCE);

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), ...(worldSource ? [liveViewPlugin(worldSource)] : [])],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: worldSource ? undefined : { "/api": "http://127.0.0.1:8787" },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
