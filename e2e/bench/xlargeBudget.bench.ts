import { mkdtempSync } from "node:fs";
import * as os from "node:os";
import { join } from "node:path";

import { afterAll, bench, describe } from "vitest";

import { removeTempDir } from "../helpers/appSession.ts";
import { getBinaryPath } from "../helpers/buildOnce.ts";

import { generateFixture, SIZES } from "./openFixtures.ts";
import { COLS, measureOpenOnce, ROWS, type WorkloadStepKey, type WorkloadStepResult } from "./openMeasure.ts";
import { measureFloorPty, NODE_FLOOR_ARGS } from "./ptyFloor.ts";
import { median } from "./stats.ts";

// Perf gate for a big file (docs/TODO/OpenPerformance.md, stage 2): `xlarge` (13 MB, 200 K lines) must open
// like a small one and a keystroke must not depend on the file size. Same harness and CI step family as
// `startupBudget.bench.ts` (`npm run test:perf:xlarge` in the `e2e (ubuntu-latest)` job); CI calibrates the budgets.
//
// Two budgets, two bench functions:
//
// 1. To text − node floor, median over `SAMPLES` runs, no workload and no inspector (same path as the
//    `small` gate and the public bench). Calibration (CI, 2026-10-23, bench-data runs after #788–#791):
//    `xlarge` median 229–251 ms of ours, `small` 131–146 on the same runs (small's own CI range over the
//    month: 92–146). The budget is the small budget + 150 ms (the human's reference point): 1.4× the worst
//    observed CI value — the same margin the small gate has (200 vs 146). It catches a new eager pass over
//    all lines on the scale of "lost lazy width" (+1000 ms) or "lost lazy folding" (+100 ms).
//
// 2. Enter and both undos after the background work has settled: the tokenizer has reached the end of the
//    file and the width sweep has measured every line (read from the editor's inspector state, no blind
//    sleep). Right after open and Go to Line the main thread belongs to the tokenizer's backlog (#787, #788),
//    and the first keys measure that backlog rather than the edit — that is what the public bench shows and
//    why `insert` is not gated here (human's decision 2026-10-23: not until the tokenizer starts from the
//    viewport after a jump — stage 3). Each run presses `EDIT_CYCLES` cycles of insert/Enter/undo/undo with a
//    pause between the cycles; the budget applies to the median over all cycles of all runs.
//    Calibration: see `KEY_BUDGET_MS`.
//
// Cost: the quiet moment comes ~45 s after spawn locally (4 cores: the TextMate tokenizer walks 200 K lines on
// the main thread, ~200 µs a line), so every key run is the expensive part. Hence few runs and several cycles
// per run, and no warmup run for the keys: the to-text bench above has already warmed the FS cache for the
// same binary and fixture. Locally the file takes ~2 min; CI is faster.
//
// Vitest bench has no budgets: an exception thrown from the bench function fails the file with a nonzero code.

/** Median of "to text − node floor" over `xlarge` samples. */
export const XLARGE_BUDGET_OURS_MS = 350;
/** Median keystroke latency (ms) after the background work has settled; keys not listed are reported only. */
export const KEY_BUDGET_MS: Readonly<Partial<Record<WorkloadStepKey, number>>> = {
    enter: 60,
    undoEnter: 60,
    undoInsert: 60,
};
const SAMPLES = 5;
const KEY_RUNS = 2;
const EDIT_CYCLES = 5;

// NB: fixtures and the floor live at module top level: in `vitest bench` mode a heavy
// beforeAll misbehaves (the bench collects no samples).
const binary = await getBinaryPath();
const fixtureDir = mkdtempSync(join(os.tmpdir(), "diode-perf-xlarge-"));
const xlarge = SIZES.find((s) => s.key === "xlarge");
if (xlarge === undefined) throw new Error("size matrix has no xlarge");
const fixture = await generateFixture(fixtureDir, xlarge);
const floorOptions = { cols: COLS, rows: ROWS, runs: 5 };
const nodeFloorMs = (await measureFloorPty(process.execPath, NODE_FLOOR_ARGS, floorOptions)).medianMs;

const fmt = (v: number | null): string => (v === null ? "—" : String(Math.round(v)));

describe("xlarge: our cost over the node floor and the keystroke after the background work settles", () => {
    const textSamples: number[] = [];
    let textCalls = 0;

    bench(
        `xlarge: to text − node floor ≤ ${String(XLARGE_BUDGET_OURS_MS)} ms (median)`,
        async () => {
            textCalls++;
            const result = await measureOpenOnce({
                binary,
                fixture,
                timeoutMs: xlarge.timeoutMs,
                workload: false,
                traceWaitMs: 0,
            });
            if (result.outcome !== "ok" || result.contentMs === null) {
                throw new Error(`file did not open: ${result.outcome} (exit ${String(result.exitCode)})`);
            }
            // The first call is tinybench's warmup iteration (FS cache) and is excluded from the stats.
            if (textCalls === 1) return;
            textSamples.push(result.contentMs - nodeFloorMs);
            if (textSamples.length === SAMPLES) {
                const ours = median(textSamples);
                const detail = `node floor ${fmt(nodeFloorMs)} ms, samples [${textSamples.map(fmt).join(", ")}]`;
                if (ours > XLARGE_BUDGET_OURS_MS) {
                    throw new Error(
                        `our ms over the node floor: ${fmt(ours)} > budget ${String(XLARGE_BUDGET_OURS_MS)} (${detail})`,
                    );
                }
                console.error(`[perf] xlarge: our ${fmt(ours)} ms over the node floor (${detail})`);
            }
        },
        { iterations: SAMPLES, time: 0, warmupIterations: 1, warmupTime: 0 },
    );

    const keySamples: WorkloadStepResult[] = [];
    const quietSamples: number[] = [];
    let keyCalls = 0;

    bench(
        `xlarge: Enter/undo after the background work settles ≤ ${String(KEY_BUDGET_MS.enter)} ms (median)`,
        async () => {
            keyCalls++;
            const result = await measureOpenOnce({
                binary,
                fixture,
                timeoutMs: xlarge.timeoutMs,
                workload: { editCycles: EDIT_CYCLES },
                quiet: true,
            });
            if (result.outcome !== "ok") {
                throw new Error(`file did not open: ${result.outcome} (exit ${String(result.exitCode)})`);
            }
            if (result.workloadOutcome !== "ok" || result.quietMs === null) {
                throw new Error(`workload ${result.workloadOutcome}: ${result.workloadError ?? "a step timed out"}`);
            }
            quietSamples.push(result.quietMs);
            keySamples.push(...result.workload);
            if (keyCalls === KEY_RUNS) {
                const lines: string[] = [`quiet at [${quietSamples.map(fmt).join(", ")}] ms since spawn`];
                const over: string[] = [];
                for (const key of ["insert", "enter", "undoEnter", "undoInsert"] as const) {
                    const values = keySamples.filter((w) => w.key === key).map((w) => w.latencyMs ?? Number.NaN);
                    const med = median(values);
                    const budget = KEY_BUDGET_MS[key];
                    lines.push(
                        `${key}: median ${fmt(med)} ms${budget === undefined ? " (not gated)" : ` (budget ${String(budget)})`} [${values.map(fmt).join(", ")}]`,
                    );
                    if (budget !== undefined && !(med <= budget)) over.push(`${key} ${fmt(med)} > ${String(budget)}`);
                }
                const detail = lines.join("; ");
                if (over.length > 0) throw new Error(`keystroke over budget: ${over.join(", ")} (${detail})`);
                console.error(`[perf] xlarge keys: ${detail}`);
            }
        },
        { iterations: KEY_RUNS, time: 0, warmupIterations: 0, warmupTime: 0 },
    );

    afterAll(() => {
        removeTempDir(fixtureDir);
    });
});
