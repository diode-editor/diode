import { existsSync, statSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { loadScenarios, runScenario } from "./scenarios/framework.ts";

// CI safety net: run every screenshot scenario against the real binary and assert
// it still produces PNGs. This keeps the demo code (in e2e/scenarios/) from
// rotting — it is not a functional test, so no domain assertions here.

const scenarios = await loadScenarios();

describe("screenshot scenarios", () => {
    it("discovers at least one scenario", () => {
        expect(scenarios.length).toBeGreaterThan(0);
    });

    for (const spec of scenarios) {
        const skip =
            (spec.skipOn?.includes(process.platform) ?? false) ||
            (spec.network === true && process.env.DIODE_E2E_OFFLINE === "1");
        // 300с вместо дефолтных 60с e2e: extension-host сценарии на холодном
        // раннере включают prepare (npm install библиотеки у eslint-lint),
        // установку расширения из магазина и старт language-сервера — та же
        // планка, что у extension-host e2e-сьютов (поймано красным main #312:
        // eslint-lint уложился на PR-прогоне и вышел за 60с на пуш-прогоне).
        it.skipIf(skip)(`renders "${spec.name}"`, { timeout: 300_000 }, async () => {
            const shots = await runScenario(spec);

            expect(shots.length).toBeGreaterThan(0);
            for (const shot of shots) {
                expect(existsSync(shot.path)).toBe(true);
                expect(statSync(shot.path).size).toBeGreaterThan(1000);
            }
        });
    }
});
