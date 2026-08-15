import { cpus } from "node:os";

import { defineConfig } from "vitest/config";

// Отдельный конфиг для e2e против собранного SEA-бинаря.
// Запускается через `npm run test:e2e`. В обычный `npm test` не попадает,
// поэтому unit-тесты остаются быстрыми.

// Параллелизм e2e: инстансы изолированы (свой user-data-dir + HOME + cwd, см.
// e2e/helpers/appSession.ts), поэтому файлы можно гонять параллельно. Каждый файл
// поднимает тяжёлый SEA-бинарь (+ PTY, + subprocess ext-host), поэтому по умолчанию
// берём половину ядер — иначе на 4-ядерной машине четыре бинаря насыщают CPU и
// тайминг-чувствительные тесты (рестарт, ext-host RPC, PTY-ввод) флейкают.
// Переопределяется через DIODE_E2E_WORKERS; `=1` — полностью последовательный прогон.
const defaultWorkers = Math.max(1, Math.floor(cpus().length / 2));
const workers = Math.max(1, Number(process.env.DIODE_E2E_WORKERS ?? String(defaultWorkers)));

export default defineConfig({
    test: {
        include: ["e2e/**/*.test.ts"],
        testTimeout: 60_000,
        hookTimeout: 180_000,
        // Собираем бинарь один раз до воркеров; путь уходит в env (DIODE_E2E_BINARY).
        globalSetup: ["e2e/globalSetup.ts"],
        pool: "forks",
        fileParallelism: workers > 1,
        maxWorkers: workers,
        minWorkers: 1,
        coverage: { enabled: false },
    },
});
