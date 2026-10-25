import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const alias = {
  "@": resolve(__dirname, "src"),
  "server-only": resolve(__dirname, "tests/support/empty.ts"),
};

/**
 * Two tiers:
 *   unit        — pure tests, never touch a database
 *   integration — destructive database tests; global setup recreates a
 *                 disposable LOCAL test database behind a fail-closed guard
 */
export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: "unit", environment: "node", include: ["tests/unit/**/*.test.ts"], testTimeout: 20_000 },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/support/global-setup.ts"],
          setupFiles: ["tests/support/env.ts"],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
