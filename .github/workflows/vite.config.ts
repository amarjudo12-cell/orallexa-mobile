import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  build: { outDir: "dist", sourcemap: false, assetsInlineLimit: 0, modulePreload: { polyfill: false } },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
