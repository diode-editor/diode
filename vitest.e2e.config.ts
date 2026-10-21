import { defineConfig } from "vitest/config";

import { planWorkers } from "./scripts/e2e-plan.mjs";

// `npm run test:e2e` runs this config via scripts/e2e.mjs (reruns failed files);
// a narrow run is `npx vitest run --config vitest.e2e.config.ts <file>`.

// Instances are isolated (own user-data-dir + HOME + cwd), hence parallel;
// DIODE_E2E_WORKERS overrides the worker count.
const { workers } = planWorkers();

/**
 * Real JVMs (redhat.java, ~1 GB+ each): two pairs at once on 7.6 GB peaked at 6.3 GB with
 * timeouts, hence after the rest and one at a time. A new JVM consumer goes here too.
 */
const HEAVY = ["e2e/marketplace/marketplace.test.ts", "e2e/scenarios-heavy.test.ts"];

const shared = {
    testTimeout: 60_000,
    hookTimeout: 180_000,
    pool: "forks",
    // A vitest retry hides flakes; scripts/e2e.mjs reruns and names them out loud.
    retry: 0,
} as const;

export default defineConfig({
    test: {
        // Binaries are built once before the workers; workers never build them.
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
