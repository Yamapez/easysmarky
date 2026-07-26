import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/main.ts"),
      name: "EasySmarky",
      formats: ["iife"],
      fileName: () => "easysmarky.iife.js",
    },
    outDir: "dist",
    cssCodeSplit: false,
    minify: true,
  },
});
