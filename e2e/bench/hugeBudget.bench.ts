import { mkdtempSync } from "node:fs";
import * as os from "node:os";
import { join } from "node:path";

import { afterAll, bench, describe } from "vitest";

import { removeTempDir } from "../helpers/appSession.ts";
import { getBinaryPath } from "../helpers/buildOnce.ts";

import { generateFixture, MiB, SIZES } from "./openFixtures.ts";
import { COLS, measureOpenOnce, ROWS } from "./openMeasure.ts";
import { measureFloorPty, NODE_FLOOR_ARGS } from "./ptyFloor.ts";
import { median } from "./stats.ts";

// Perf gate for a giant file (docs/TODO/OpenPerformance.md, stage 4): `log500m` (497 MB, 5.3 M lines) opens
// read-only on disk (4.1, 4.2) and must open like a small file. Same harness and CI step family as
// `startupBudget.bench.ts` and `xlargeBudget.bench.ts` (`npm run test:perf:huge` in the `e2e (ubuntu-latest)` job).
//
// One run of the binary gives three numbers, each with its own budget on the median over `SAMPLES` runs:
//
// 1. To text − node floor (no inspector, the same path as the `small` gate). The first screen of a document on
//    disk is one synchronous chunk, so the size must not show. Calibration (CI bench-data, 2026-10-24, three
//    runs after #799): `log500m` 113–155 ms of ours, `small` 102–150 on the same runs (+10 on average). The
//    budget is the small budget + 100 ms (the human's reference point): 2× the worst observed value. It catches
//    the file read into memory again (the old path: 4016 ms locally) and a new pass over the file before the
//    first frame; a regression of tens of ms is the `small` gate's business.
// 2. The line index done: ms from spawn until the status bar's "Indexing N%" is gone (black box). CI: 723–1129 ms.
//    The budget is 1.4× the worst observed value, the margin of the `small` gate (200 vs 146). It catches a
//    slower index walk (a per-line allocation, a lost block read).
// 3. Peak RSS of the process over the run, the index included. CI: 259–296 MB (`small`: 237–251). The budget is
//    1.4× the worst observed value, it catches the file text in memory (783 MB with the old path) and a fat index
//    (4 bytes a line today: 21 MB on `log500m`).
//
// `log2g` (2 GB, 21.7 M lines) is not in the gate: it gives no signal of its own. Its first screen is the same
// single chunk (locally 221 ms vs 208 for `log500m`), the index and its memory are linear in the line count and
// are guarded by (2) and (3) on `log500m`. The price would be 2 GB of the runner's disk and ~4× the fixture
// write and the index time per run. It stays an opt-in size of `bench:open` (`--sizes=log2g`).
//
// Cost: the fixture write (~10 s on CI) plus 6 runs of ~1.5 s (text, index, shutdown).
//
// Vitest bench has no budgets: an exception thrown from the bench function fails the file with a nonzero code.

/** Median of "to text − node floor" over `log500m` samples. */
export const LOG500M_BUDGET_OURS_MS = 300;
/** Median ms from spawn until the line index is done. */
export const INDEX_BUDGET_MS = 1600;
/** Median peak RSS of the process, the index included. */
export const RSS_BUDGET_BYTES = 420 * MiB;
const SAMPLES = 5;

// NB: fixtures and the floor live at module top level: in `vitest bench` mode a heavy
// beforeAll misbehaves (the bench collects no samples).
const binary = await getBinaryPath();
const fixtureDir = mkdtempSync(join(os.tmpdir(), "diode-perf-huge-"));
const log500m = SIZES.find((s) => s.key === "log500m");
if (log500m === undefined) throw new Error("size matrix has no log500m");
const fixture = await generateFixture(fixtureDir, log500m);
const floorOptions = { cols: COLS, rows: ROWS, runs: 5 };
const nodeFloorMs = (await measureFloorPty(process.execPath, NODE_FLOOR_ARGS, floorOptions)).medianMs;

const fmt = (v: number | null): string => (v === null ? "—" : String(Math.round(v)));
const fmtMiB = (v: number): string => String(Math.round(v / MiB));

describe("log500m: the giant file opens read-only on disk like a small one", () => {
    const textSamples: number[] = [];
    const indexSamples: number[] = [];
    const rssSamples: number[] = [];
    let textCalls = 0;

    bench(
        `log500m: to text − node floor ≤ ${String(LOG500M_BUDGET_OURS_MS)} ms, index ≤ ${String(INDEX_BUDGET_MS)} ms (median)`,
        async () => {
            textCalls++;
            const result = await measureOpenOnce({
                binary,
                fixture,
                timeoutMs: log500m.timeoutMs,
                workload: false,
                waitForIndexing: true,
                traceWaitMs: 0,
            });
            if (result.outcome !== "ok" || result.contentMs === null) {
                throw new Error(`file did not open: ${result.outcome} (exit ${String(result.exitCode)})`);
            }
            if (result.quietMs === null) throw new Error(result.workloadError ?? "the line index did not finish");
            // The first call is tinybench's warmup iteration (FS cache) and is excluded from the stats.
            if (textCalls === 1) return;
            textSamples.push(result.contentMs - nodeFloorMs);
            indexSamples.push(result.quietMs);
            if (result.peakRssBytes !== null) rssSamples.push(result.peakRssBytes);
            if (textSamples.length === SAMPLES) {
                const ours = median(textSamples);
                const index = median(indexSamples);
                const rss = rssSamples.length > 0 ? median(rssSamples) : null;
                const detail = [
                    `node floor ${fmt(nodeFloorMs)} ms`,
                    `to text [${textSamples.map(fmt).join(", ")}]`,
                    `index [${indexSamples.map(fmt).join(", ")}] ms`,
                    `peak RSS [${rssSamples.map(fmtMiB).join(", ")}] MiB`,
                ].join("; ");
                const over: string[] = [];
                if (ours > LOG500M_BUDGET_OURS_MS)
                    over.push(`to text ${fmt(ours)} > ${String(LOG500M_BUDGET_OURS_MS)} ms`);
                if (index > INDEX_BUDGET_MS) over.push(`index ${fmt(index)} > ${String(INDEX_BUDGET_MS)} ms`);
                if (rss !== null && rss > RSS_BUDGET_BYTES) {
                    over.push(`peak RSS ${fmtMiB(rss)} > ${fmtMiB(RSS_BUDGET_BYTES)} MiB`);
                }
                if (over.length > 0) throw new Error(`log500m over budget: ${over.join(", ")} (${detail})`);
                console.error(
                    `[perf] log500m: our ${fmt(ours)} ms over the node floor, index ${fmt(index)} ms (${detail})`,
                );
            }
        },
        { iterations: SAMPLES, time: 0, warmupIterations: 1, warmupTime: 0 },
    );

    afterAll(() => {
        removeTempDir(fixtureDir);
    });
});
