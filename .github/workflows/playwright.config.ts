import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: {
    viewport: { width: 390, height: 844 },
    launchOptions: process.env.CHROME ? { executablePath: process.env.CHROME } : {},
  },
  webServer: { command: "npx vite preview --port 4174 --strictPort", port: 4174, reuseExistingServer: false },
});
