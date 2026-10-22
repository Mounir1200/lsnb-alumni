import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// A separate HTML entry and output. The public site never imports the hub.
export default defineConfig({
  root: "hub",
  envDir: "..",
  cacheDir: "../node_modules/.vite-hub",
  publicDir: "../public",
  plugins: [react()],
  server: { port: 5174, strictPort: true },
  preview: { port: 4174, strictPort: true },
  build: { outDir: "../dist-hub", emptyOutDir: true },
});
