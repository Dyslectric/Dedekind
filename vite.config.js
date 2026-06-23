import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2020",
    outDir: "dist",
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three"],
          mathjs: ["mathjs"],
          react: ["react", "react-dom"],
          // fflate is used by both the eager index chunk (serialize.js, URL-hash
          // compression) and the lazy Editor chunk (projectfile.js, .ddk zip).
          // Left unsplit, Rollup folds it into index and the Editor chunk imports
          // its bindings across the lazy boundary — which reorders init and trips
          // a load-time TDZ ("can't access lexical declaration before
          // initialization") when the Editor chunk evaluates. Giving fflate its
          // own chunk makes it a shared dependency that initializes before both.
          fflate: ["fflate"],
        },
      },
    },
  },
});
