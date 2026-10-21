import { defineConfig } from "vitest/config";

// `npm run test:perf`: числа бенчей не флапают CI и не влияют на coverage.
export default defineConfig({
    test: {
        include: ["src/**/*.bench.ts", "e2e/bench/**/*.bench.ts"],
        testTimeout: 120_000,
        hookTimeout: 180_000,
        // Параллельный прогон искажает измерения и плодит chokidar-watcher'ы.
        fileParallelism: false,
        pool: "forks",
        coverage: { enabled: false },
    },
});
