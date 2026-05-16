import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
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
