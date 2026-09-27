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

// Перф-гейт кухни старта (docs/TODO/OpenPerformance.md, этап «Линейка»).
// Запуск: `npm run test:perf` (тяжёлый прогон: собирает SEA-бинарь — под лизу).
//
// Меряется то же, что публикует docs/public/BENCH-OPEN.md: SEA-бинарь в PTY,
// `small` (100 строк), «наших мс» = до текста − пол node (тем же PTY-спауном).
// Публичная цифра обязана быть защищена тестом (docs/public/README.md): бюджет
// ниже — храповик. Сейчас он щедрый (текущее число с запасом на слабую
// машину); этап «Кухня» зажимает его по мере снятия стоимости.
//
// Vitest bench не умеет бюджетов сам: исключение из функции бенча роняет файл
// (и `test:perf`) с ненулевым кодом — этим и пользуемся на последнем сэмпле.

/** Бюджет «наших мс над полом node» для `small`, медиана по сэмплам. */
export const STARTUP_BUDGET_OURS_MS = 900;
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
