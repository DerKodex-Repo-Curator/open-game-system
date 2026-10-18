import { resolve } from "node:path";
import { defineConfig } from "vite";

// Two pages: index.html is the phone controller (the manifest's startUrl), tv.html the TV page.
export default defineConfig({
  build: {
    outDir: "dist",
    rollupOptions: {
      input: { phone: resolve(__dirname, "index.html"), tv: resolve(__dirname, "tv.html") },
    },
  },
});
