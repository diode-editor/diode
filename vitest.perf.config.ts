import { defineConfig } from "vitest/config";

// `npm run test:perf`: bench numbers do not flake CI and do not affect coverage.
export default defineConfig({
    test: {
        include: ["src/**/*.bench.ts", "e2e/bench/**/*.bench.ts"],
        testTimeout: 120_000,
        hookTimeout: 180_000,
        // A parallel run skews measurements and spawns extra chokidar watchers.
        fileParallelism: false,
        pool: "forks",
        coverage: { enabled: false },
    },
});
