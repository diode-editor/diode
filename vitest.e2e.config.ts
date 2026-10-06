import { defineConfig } from "vitest/config";

import { planWorkers } from "./scripts/e2e-plan.mjs";

// Отдельный конфиг для e2e против собранного SEA-бинаря. В обычный `npm test` не
// попадает, поэтому unit-тесты остаются быстрыми. `npm run test:e2e` зовёт его
// через scripts/e2e.mjs — обёртку с автоповтором упавших файлов; прямой
// `npx vitest run --config vitest.e2e.config.ts <файл>` — для узкого прогона.

// Параллелизм e2e: инстансы изолированы (свой user-data-dir + HOME + cwd, см.
// e2e/helpers/appSession.ts), поэтому файлы можно гонять параллельно. Сколько —
// решает planWorkers: меньшее из половины ядер, всей памяти и свободной СЕЙЧАС
// памяти (по 1,5 ГБ на воркер — редактор с языковым сервером). Переопределяется
// через DIODE_E2E_WORKERS; `=1` — полностью последовательный прогон.
const { workers } = planWorkers();

/**
 * Тяжёлая полоса: файлы, поднимающие настоящие JVM (redhat.java — syntax- и
 * standard-сервер, по ~1 ГБ+). Две такие пары разом на 7,6 ГБ дали пик 6,3 ГБ и
 * таймауты обеих (и соседних сценариев от голода по CPU). Поэтому они идут
 * отдельной группой ПОСЛЕ остальных и строго по одному. Список узкий намеренно:
 * всё, что сюда попадает, теряет параллельность. Новый потребитель JVM — сюда же.
 */
const HEAVY = ["e2e/marketplace/marketplace.test.ts", "e2e/scenarios-heavy.test.ts"];

const shared = {
    testTimeout: 60_000,
    hookTimeout: 180_000,
    pool: "forks",
    // Повтора на уровне vitest нет намеренно: он прячет флаки. Упавшие файлы
    // перепрогоняет scripts/e2e.mjs вторым проходом и называет флаки вслух.
    retry: 0,
} as const;

export default defineConfig({
    test: {
        // Бинари — неизменяемая сборка из кэша по хешу исходников, один раз до
        // воркеров; пути уходят в env (DIODE_E2E_BINARY, DIODE_E2E_SELFEXTRACT),
        // воркеры сами не собирают никогда. См. e2e/globalSetup.ts.
        globalSetup: ["e2e/globalSetup.ts"],
        coverage: { enabled: false },
        projects: [
            {
                test: {
                    ...shared,
                    name: "e2e",
                    include: ["e2e/**/*.test.ts"],
                    exclude: HEAVY,
                    fileParallelism: workers > 1,
                    maxWorkers: workers,
                    sequence: { groupOrder: 0 },
                },
            },
            {
                test: {
                    ...shared,
                    name: "e2e-heavy",
                    include: HEAVY,
                    fileParallelism: false,
                    maxWorkers: 1,
                    sequence: { groupOrder: 1 },
                },
            },
        ],
    },
});
