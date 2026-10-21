import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadScenarios, runScenario, scenarioFiles } from "./framework.ts";

// CI safety net: every screenshot scenario must still produce PNGs against the real binary — no domain assertions.
// Slices, because a single file takes minutes in one worker, and a flake retries it as a whole.

/** When changing, add or remove the matching `e2e/scenarios-<N>.test.ts` files. */
export const SCENARIO_SLICES = 4;

/** Run sequentially after the rest (vitest.e2e.config.ts); excluded from the regular slices. */
export const HEAVY_SCENARIOS: readonly string[] = ["java-lsp.scenario.ts", "javaMoveTypeUndo.scenario.ts"];

const e2eDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

export async function scenarioSuite(index: number | "heavy"): Promise<void> {
    const scenarios = await loadScenarios((file, i) =>
        index === "heavy" ? HEAVY_SCENARIOS.includes(file) : !HEAVY_SCENARIOS.includes(file) && i % SCENARIO_SLICES === index - 1,
    );

    describe(`screenshot scenarios ${String(index)}/${String(SCENARIO_SLICES)}`, () => {
        it("срез непустой, а файлов срезов ровно столько, сколько срезов", () => {
            expect(scenarios.length).toBeGreaterThan(0);
            for (const heavy of HEAVY_SCENARIOS) expect(scenarioFiles()).toContain(heavy);
            // Otherwise some scenarios would silently drop out of the run: slice 5 of 4 is empty, and a forgotten slice
            // file is a quarter left unrun.
            const sliceFiles = readdirSync(e2eDir).filter((f) => /^scenarios-\d+\.test\.ts$/.test(f));
            expect(sliceFiles.sort()).toEqual(Array.from({ length: SCENARIO_SLICES }, (_, i) => `scenarios-${String(i + 1)}.test.ts`));
            expect(scenarioFiles().length).toBeGreaterThanOrEqual(SCENARIO_SLICES);
        });

        for (const spec of scenarios) {
            const skip =
                (spec.skipOn?.includes(process.platform) ?? false) ||
                (spec.network === true && process.env.DIODE_E2E_OFFLINE === "1") ||
                spec.requires?.() !== undefined;
            // 300s instead of the default 60s e2e timeout: extension host scenarios on a cold runner include prepare
            // (npm install of the library for eslint-lint), installing the extension from the marketplace and starting
            // the language server — the same bar as the extension host e2e suites (caught by a red main #312:
            // eslint-lint fit on the PR run and exceeded 60s on the push run). `spec.timeoutMs` is for scenarios where
            // 300s is not enough: the java-lsp case includes installing a 139 MB platform vsix, importing a maven
            // project and starting TWO JVMs (syntax + standard server). Same convention as
            // `IMarketplaceCheck.timeoutMs`.
            it.skipIf(skip)(`renders "${spec.name}"`, { timeout: spec.timeoutMs ?? 300_000 }, async () => {
                const shots = await runScenario(spec);

                expect(shots.length).toBeGreaterThan(0);
                for (const shot of shots) {
                    expect(existsSync(shot.path)).toBe(true);
                    expect(statSync(shot.path).size).toBeGreaterThan(1000);
                }
            });
        }
    });
}
