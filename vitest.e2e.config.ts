import { defineConfig } from "vitest/config";

import { planWorkers } from "./scripts/e2e-plan.mjs";

// `npm run test:e2e` зовёт конфиг через scripts/e2e.mjs (автоповтор упавших файлов);
// узкий прогон — `npx vitest run --config vitest.e2e.config.ts <файл>`.

// Инстансы изолированы (свой user-data-dir + HOME + cwd), поэтому параллельно;
// число воркеров переопределяется DIODE_E2E_WORKERS.
const { workers } = planWorkers();

/**
 * Настоящие JVM (redhat.java, по ~1 ГБ+): две пары разом на 7,6 ГБ дали пик 6,3 ГБ и
 * таймауты — поэтому после остальных и по одному. Новый потребитель JVM — сюда же.
 */
const HEAVY = ["e2e/marketplace/marketplace.test.ts", "e2e/scenarios-heavy.test.ts"];

const shared = {
    testTimeout: 60_000,
    hookTimeout: 180_000,
    pool: "forks",
    // Повтор vitest прячет флаки; scripts/e2e.mjs перепрогоняет и называет их вслух.
    retry: 0,
} as const;

export default defineConfig({
    test: {
        // Бинари собираются один раз до воркеров; воркеры сами не собирают никогда.
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
