import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Local type stub so we can read process.env without adding @types/node to
// devDependencies just for this one file. vite.config.ts runs in Node at
// build/dev startup, so process is always defined here.
declare const process: { env: Record<string, string | undefined> };

// Vite 5 blocks requests whose Host header is not in this allowlist (defence
// against DNS-rebinding attacks on the dev server). When the dev stack runs
// behind a host-level nginx with a custom domain (e.g. lg.example.com), the
// proxied Host header trips this guard with "Blocked request" in the page.
// Set VITE_ALLOWED_HOSTS in deploy/.env to a comma-separated list of the
// public domains the dev server should answer to.
const allowedHosts: string[] = (process.env.VITE_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((s: string) => s.trim())
  .filter(Boolean);

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    allowedHosts: allowedHosts.length ? allowedHosts : undefined,
    hmr: {
      clientPort: 443,
    },
    proxy: {
      "/api": {
        target: "http://api:8000",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://api:8000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    // Split the heaviest deps out of the main bundle. recharts and the world
    // map together ate ~70% of the previous 1.0 MB chunk. With these named
    // groups, routes that don't need them (Login, list pages) won't fetch
    // them on first paint.
    rollupOptions: {
      output: {
        manualChunks: {
          recharts: ["recharts"],
          maps: ["react-simple-maps", "d3-geo"],
          react: ["react", "react-dom", "react-router-dom"],
          query: ["@tanstack/react-query"],
        },
      },
    },
  },
});
