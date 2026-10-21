import { mkdtempSync } from "node:fs";
import * as os from "node:os";
import { join } from "node:path";

import { afterAll, bench, describe } from "vitest";

import { removeTempDir } from "../helpers/appSession.ts";
import { getBinaryPath } from "../helpers/buildOnce.ts";

import { generateFixture, SIZES } from "./openFixtures.ts";
import { COLS, measureOpenOnce, ROWS } from "./openMeasure.ts";
import { measureFloorPty, NODE_FLOOR_ARGS } from "./ptyFloor.ts";
import { median } from "./stats.ts";

// Перф-гейт кухни старта: публичная цифра docs/public/BENCH-OPEN.md обязана быть защищена
// тестом. `npm run test:perf` — под лизу; в CI — шаг `npm run test:perf:startup` job'а
// `e2e (ubuntu-latest)`, по нему и калибровка.
//
// Калибровка (2026-10-16): медиана CI — 99 мс наших (IQR 16). Бюджет вдвое, чтобы shared runner
// не флапал: ловит откаты масштаба «потеряли снапшот» (+60…90 мс). Локально ~170 наших —
// может упираться в бюджет, авторитет здесь CI.
//
// Vitest bench бюджетов не умеет: исключение из функции бенча роняет файл с ненулевым кодом.

/** Медиана по сэмплам `small`. */
export const STARTUP_BUDGET_OURS_MS = 200;
const SAMPLES = 5;

// NB: фикстуры и пол — на верхнем уровне модуля: в режиме `vitest bench` тяжёлый
// beforeAll отрабатывает некорректно (бенч не набирает сэмплов).
const binary = await getBinaryPath();
const fixtureDir = mkdtempSync(join(os.tmpdir(), "diode-perf-open-"));
const small = SIZES.find((s) => s.key === "small");
if (small === undefined) throw new Error("матрица размеров без small");
const fixture = await generateFixture(fixtureDir, small);
const floorOptions = { cols: COLS, rows: ROWS, runs: 5 };
const nodeFloorMs = (await measureFloorPty(process.execPath, NODE_FLOOR_ARGS, floorOptions)).medianMs;

const samples: number[] = [];
let calls = 0;

describe("Старт: кухня над полом node (SEA в PTY, small)", () => {
    bench(
        `small: до текста − пол node ≤ ${String(STARTUP_BUDGET_OURS_MS)} мс (median)`,
        async () => {
            calls++;
            const result = await measureOpenOnce({
                binary,
                fixture,
                timeoutMs: small.timeoutMs,
                workload: false,
                traceWaitMs: 0,
            });
            if (result.outcome !== "ok" || result.contentMs === null) {
                throw new Error(`файл не открылся: ${result.outcome} (exit ${String(result.exitCode)})`);
            }
            // Первый вызов — прогревочная итерация tinybench (FS-кеш), в статистику не идёт.
            if (calls === 1) return;
            samples.push(result.contentMs - nodeFloorMs);
            if (samples.length === SAMPLES) {
                const ours = median(samples);
                const detail = `пол node ${String(Math.round(nodeFloorMs))} мс, сэмплы [${samples.map((v) => String(Math.round(v))).join(", ")}]`;
                if (ours > STARTUP_BUDGET_OURS_MS) {
                    throw new Error(
                        `наших мс над полом node: ${String(Math.round(ours))} > бюджет ${String(STARTUP_BUDGET_OURS_MS)} (${detail})`,
                    );
                }
                console.error(`[perf] small: наших ${String(Math.round(ours))} мс над полом node (${detail})`);
            }
        },
        { iterations: SAMPLES, time: 0, warmupIterations: 1, warmupTime: 0 },
    );

    afterAll(() => {
        removeTempDir(fixtureDir);
    });
});
