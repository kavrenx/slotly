import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", environment: "node", include: ["src/**/*.test.ts"] } },
      { test: { name: "integration", environment: "node", include: ["tests/integration/**/*.test.ts"], testTimeout: 20_000, hookTimeout: 30_000, fileParallelism: false } },
    ],
  },
});
