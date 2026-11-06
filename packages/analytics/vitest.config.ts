import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // one Postgres container per file; tests within a file share it
    hookTimeout: 120_000,
    testTimeout: 60_000,
    fileParallelism: false,
  },
});
