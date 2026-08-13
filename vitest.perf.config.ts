import { defineConfig } from "vitest/config";

// Отдельный конфиг для перформанс-бенчмарков (vitest `bench`).
// Запускается через `npm run test:perf`. В обычный `npm test` не попадает
// (тот берёт только *.test.ts), поэтому unit-тесты остаются быстрыми, а
// числа бенчей не флапают CI и не влияют на coverage.
export default defineConfig({
    test: {
        include: ["src/**/*.bench.ts"],
        testTimeout: 120_000,
        hookTimeout: 180_000,
        // Бенчи активно работают с файловой системой и chokidar-watcher'ами —
        // параллельный прогон искажает измерения и плодит watcher'ы.
        fileParallelism: false,
        pool: "forks",
        coverage: { enabled: false },
    },
});
