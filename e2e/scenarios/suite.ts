import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadScenarios, runScenario, scenarioFiles } from "./framework.ts";

// CI safety net: run every screenshot scenario against the real binary and assert
// it still produces PNGs. This keeps the demo code (in e2e/scenarios/) from
// rotting — it is not a functional test, so no domain assertions here.
//
// Сценарии нарезаны на SCENARIO_SLICES файлов `e2e/scenarios-<N>.test.ts`: одним
// файлом это были минуты в одном воркере — самый длинный файл прогона, который
// не делится между воркерами и при флаке повторяется целиком. Срез — каждый
// N-й файл сценария по имени (см. `loadScenarios`); сценарии с JVM — отдельным
// файлом `scenarios-heavy.test.ts` в тяжёлой полосе.

/** Сколько срезов. Меняешь — заведи/убери файлы `e2e/scenarios-<N>.test.ts`. */
export const SCENARIO_SLICES = 4;

/**
 * Сценарии с настоящими JVM — отдельным файлом `e2e/scenarios-heavy.test.ts` в
 * тяжёлой полосе (последовательно, после остальных; см. vitest.e2e.config.ts).
 * В обычные срезы они не попадают.
 */
export const HEAVY_SCENARIOS: readonly string[] = ["java-lsp.scenario.ts"];

const e2eDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

export async function scenarioSuite(index: number | "heavy"): Promise<void> {
    const scenarios = await loadScenarios((file, i) =>
        index === "heavy" ? HEAVY_SCENARIOS.includes(file) : !HEAVY_SCENARIOS.includes(file) && i % SCENARIO_SLICES === index - 1,
    );

    describe(`screenshot scenarios ${String(index)}/${String(SCENARIO_SLICES)}`, () => {
        it("срез непустой, а файлов срезов ровно столько, сколько срезов", () => {
            expect(scenarios.length).toBeGreaterThan(0);
            for (const heavy of HEAVY_SCENARIOS) expect(scenarioFiles()).toContain(heavy);
            // Иначе часть сценариев молча выпала бы из прогона: срез 5 из 4 пуст,
            // а забытый файл среза — это непрогнанная четверть.
            const sliceFiles = readdirSync(e2eDir).filter((f) => /^scenarios-\d+\.test\.ts$/.test(f));
            expect(sliceFiles.sort()).toEqual(Array.from({ length: SCENARIO_SLICES }, (_, i) => `scenarios-${String(i + 1)}.test.ts`));
            expect(scenarioFiles().length).toBeGreaterThanOrEqual(SCENARIO_SLICES);
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
            // `spec.timeoutMs` — для сценариев, которым 300с мало: у java-lsp внутрь
            // кейса попадают установка 139-МБ платформенного vsix, импорт
            // maven-проекта и старт ДВУХ JVM (syntax + standard server). Та же
            // договорённость, что у `IMarketplaceCheck.timeoutMs`.
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
