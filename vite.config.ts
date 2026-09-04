import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three")) return "visual-three";
          if (id.includes("node_modules/@supabase")) return "data-supabase";
          if (id.includes("node_modules/animejs")) return "motion-anime";
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) {
            return "react-core";
          }
          return undefined;
        },
      },
    },
  },
});
