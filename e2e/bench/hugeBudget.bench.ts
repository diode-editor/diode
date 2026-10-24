import { bench, describe } from "vitest";

import { removeTempDir } from "../helpers/appSession.ts";
import { getBinaryPath } from "../helpers/buildOnce.ts";

import {
    measureEnableEditing,
    measureFind,
    measureFollow,
    measureIndex,
    WALK_FROM_PERCENT,
    WALK_TO_PERCENT,
} from "./hugeMeasure.ts";
import { gateFixtureDir, generateFixture, MiB, SIZES } from "./openFixtures.ts";
import { COLS, measureOpenOnce, ROWS, type WorkloadStepKey, type WorkloadStepResult } from "./openMeasure.ts";
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
// 2. The line index done: ms from spawn until the status bar's "Indexing N%" is gone (black box); the entry must
//    show at all (an index that never shows is gone or synchronous, not done). CI: 723–1129 ms. The budget is 1.4×
//    the worst observed value, the margin of the `small` gate (200 vs 146). It catches the index lost or made
//    synchronous before the first frame; the walk is only part of this wall time (startup and the extension host
//    share the thread with its first chunks), so a 2× slower walk moves it by 12–50 % — that is (4)'s job.
// 3. Peak RSS of the process over the run, the index included. CI: 259–296 MB (`small`: 237–251). The budget is
//    1.4× the worst observed value, it catches the file text in memory (783 MB with the old path) and a fat index
//    (4 bytes a line today: 21 MB on `log500m`).
//
// Then steps on live editors (`hugeMeasure.ts`), budgets on the median of all samples of all runs:
//
// 4. The index walk itself: from the first frame with "Indexing 10%" to the first with 90% (or gone), in runs
//    without input — the bytes in between are walked after the startup work is over, so the time is the walk's.
// 5. A key during the index: ArrowDown sent while "Indexing N%" is up, to the status bar's next `Ln`, in other
//    runs. The index must leave the editor answering (4.2); a walk that blocks the thread for the whole index
//    (planted by the tester of #805: 445–555 ms a key vs 20–43) keeps (1)–(4) green and shows only here.
//    Calibration (CI, PR #805, run 40103572500 — a fast runner: `small` 102, index from spawn 749 vs 1060–1078 on
//    the earlier runs, 1.44× slower): walk 343/344 ms, budget 700 — 1.4× the walk scaled to the slower runner
//    (~495), so a 2× walk is caught there (~990) and is borderline on the fastest one (~690). Keys: median 7 ms
//    (5–9; the first key of a run, at the index start, shares the thread with the startup: 138–144), budget 20 —
//    2.5–3× the median like the `xlarge` keys.
// 6. Follow (4.4): `Ctrl+End`, then a line appended to the file, timed to the frame that shows it. The watcher's
//    window is 50 ms, so the floor is ~55 ms (4.4: median 55.7, p90 57.9 locally); a budget below the window
//    would take a decision for the whole watcher. It catches a re-read of the file instead of the tail.
// 7. Find (4.3) on the read-only document: a query whose only match is in the middle of the file, from the paste
//    to the counter (half a walk from the cursor at line 1), and characters typed while the walks run — each one
//    starts a new walk over the whole file, the next one must not wait for it. It catches a synchronous walk
//    (the key would take the whole walk: ~25 s on `log2g` before 4.3) and a slower walk. Calibration (CI, PR #805,
//    after #800): first match 1639/1680 ms, budget 2400 (1.4× the worst); keys median 8 ms (6–9), budget 20 like
//    the `xlarge` Enter: 2.5× the median, so that a 1.6× slower runner keeps headroom — a slice of the walk is
//    ~6 ms (4096 lines), a bigger or synchronous one shows.
// 8. Enable Editing (4.5): from the toast's button to the editable tab, ArrowDown while the file streams into
//    memory, and edit cycles (insert, Enter, undo, undo) right after the switch, when tokenization and folding come
//    back on 500 MB and take the main thread in 200–300 ms slices. It catches a load that freezes again and a
//    restored feature that walks the file on the key path. Calibration (CI, the same fast run): to editable
//    1813/1860 ms, budget 3800 (1.4× the value scaled to the slower runner); keys during the load median 10 ms
//    (2–48), budget 30; edit keys after the switch median 9 ms (3–86), budget 25 — 2.5–3× the median.
//
// `log2g` (2 GB, 21.7 M lines) is not in the gate: it gives no signal of its own. Its first screen is the same
// single chunk (locally 221 ms vs 208 for `log500m`), the index and its memory are linear in the line count and
// are guarded by (2) and (3) on `log500m`. The price would be 2 GB of the runner's disk and ~4× the fixture
// write and the index time per run. It stays an opt-in size of `bench:open` (`--sizes=log2g`).
//
// Cost: the fixture write (~10 s on CI), 6 runs of ~1.5 s (text, index, shutdown), then the steps: ~10 s each
// for the index, follow and find and ~15 s for Enable Editing locally. Disk: the 500 MB fixture, removed at the end
// of the last bench (`gateFixtureDir`).
//
// Vitest bench has no budgets: an exception thrown from the bench function fails the file with a nonzero code.

/** Median of "to text − node floor" over `log500m` samples. */
export const LOG500M_BUDGET_OURS_MS = 300;
/** Median ms from spawn until the line index is done. */
export const INDEX_BUDGET_MS = 1600;
/** Median peak RSS of the process, the index included. */
export const RSS_BUDGET_BYTES = 420 * MiB;
const SAMPLES = 5;
// TODO(calibrate on CI after #802): the follow budget is a first guess from the local numbers of 4.4.
/** Median ms of the index walk between `WALK_FROM_PERCENT` and `WALK_TO_PERCENT`. */
export const WALK_BUDGET_MS = 700;
/** Median ms of ArrowDown while the line index runs. */
export const INDEX_KEY_BUDGET_MS = 20;
/** Median ms from a line appended to the file to the frame that shows it, follow on. */
export const FOLLOW_BUDGET_MS = 150;
/** Median ms from pasting a query with one match in the middle of the file to the counter showing it. */
export const FIND_FIRST_MATCH_BUDGET_MS = 2400;
/** Median ms of a typed character in the find input while a walk over the file runs. */
export const FIND_KEY_BUDGET_MS = 20;
/** Median ms from pressing Enable Editing to the editable tab. */
export const EDITABLE_BUDGET_MS = 3800;
/** Median ms of ArrowDown while the file streams into memory. */
export const LOAD_KEY_BUDGET_MS = 30;
/** Median ms of the edit keys right after the switch, while the restored features catch up. */
export const EDIT_KEY_BUDGET_MS = 25;
/** Runs of each step after the to-text bench; the FS cache is warm by then. */
const STEP_RUNS = 2;
/** Index runs: odd ones time the walk, even ones press keys. */
const INDEX_RUNS = 4;
const FOLLOW_APPENDS = 10;
/** Typed after the find query `<n> `: `request <n> handled in …`. */
const FIND_TYPED = "handled";
const EDIT_CYCLES = 3;

// NB: fixtures and the floor live at module top level: in `vitest bench` mode a heavy
// beforeAll misbehaves (the bench collects no samples).
const binary = await getBinaryPath();
const fixtureDir = gateFixtureDir("diode-perf-huge");
const log500m = SIZES.find((s) => s.key === "log500m");
if (log500m === undefined) throw new Error("size matrix has no log500m");
const fixture = await generateFixture(fixtureDir, log500m);
const floorOptions = { cols: COLS, rows: ROWS, runs: 5 };
const nodeFloorMs = (await measureFloorPty(process.execPath, NODE_FLOOR_ARGS, floorOptions)).medianMs;

const fmt = (v: number | null): string => (v === null ? "—" : String(Math.round(v)));
const fmtMiB = (v: number): string => String(Math.round(v / MiB));

interface Budget {
    readonly label: string;
    readonly values: readonly number[];
    readonly budget: number;
}

/** Logs the numbers, then throws when a median is over its budget (or there are no samples). */
function checkBudgets(step: string, budgets: readonly Budget[], note?: string): void {
    const lines = budgets.map(
        (b) =>
            `${b.label}: median ${fmt(median(b.values))} ms (budget ${String(b.budget)}) [${b.values.map(fmt).join(", ")}]`,
    );
    if (note !== undefined) lines.push(note);
    const detail = lines.join("; ");
    const over = budgets
        .filter((b) => !(median(b.values) <= b.budget))
        .map((b) => `${b.label} ${fmt(median(b.values))} > ${String(b.budget)}`);
    // Logged before the verdict: vitest reports only the first error of a file, the numbers of every step stay in the log.
    console.error(`[perf] log500m ${step}: ${detail}`);
    if (over.length > 0) throw new Error(`log500m ${step} over budget: ${over.join(", ")} (${detail})`);
}

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
                waitForIndexing: "required",
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
                console.error(
                    `[perf] log500m: our ${fmt(ours)} ms over the node floor, index ${fmt(index)} ms (${detail})`,
                );
                if (over.length > 0) throw new Error(`log500m over budget: ${over.join(", ")} (${detail})`);
            }
        },
        { iterations: SAMPLES, time: 0, warmupIterations: 1, warmupTime: 0 },
    );

    const walkSamples: number[] = [];
    const indexKeySamples: number[] = [];
    let indexCalls = 0;
    bench(
        `log500m: index walk ${String(WALK_FROM_PERCENT)}→${String(WALK_TO_PERCENT)}% ≤ ${String(WALK_BUDGET_MS)} ms, key during the index ≤ ${String(INDEX_KEY_BUDGET_MS)} ms (median)`,
        async () => {
            indexCalls++;
            const keys = indexCalls % 2 === 0;
            const result = await measureIndex(binary, fixture, { timeoutMs: log500m.timeoutMs, keys, gapMs: 50 });
            if (result.walkMs !== null) walkSamples.push(result.walkMs);
            indexKeySamples.push(...result.keyMs);
            if (indexCalls === INDEX_RUNS) {
                checkBudgets("index", [
                    { label: "walk", values: walkSamples, budget: WALK_BUDGET_MS },
                    { label: "ArrowDown during the index", values: indexKeySamples, budget: INDEX_KEY_BUDGET_MS },
                ]);
            }
        },
        { iterations: INDEX_RUNS, time: 0, warmupIterations: 0, warmupTime: 0 },
    );

    const followSamples: number[] = [];
    let followCalls = 0;
    // TODO(#802): enable once follow is on main (this branch gets rebased).
    bench.skip(
        `log500m: follow, appended line to frame ≤ ${String(FOLLOW_BUDGET_MS)} ms (median)`,
        async () => {
            followCalls++;
            followSamples.push(
                ...(await measureFollow(binary, fixture, {
                    timeoutMs: log500m.timeoutMs,
                    appends: FOLLOW_APPENDS,
                    gapMs: 200,
                })),
            );
            if (followCalls === STEP_RUNS) {
                checkBudgets("follow", [{ label: "appended line", values: followSamples, budget: FOLLOW_BUDGET_MS }]);
            }
        },
        { iterations: STEP_RUNS, time: 0, warmupIterations: 0, warmupTime: 0 },
    );

    const firstMatchSamples: number[] = [];
    const findKeySamples: number[] = [];
    const keysDuringWalk: number[] = [];
    let findCalls = 0;
    bench(
        `log500m: find, first match ≤ ${String(FIND_FIRST_MATCH_BUDGET_MS)} ms, key during the walk ≤ ${String(FIND_KEY_BUDGET_MS)} ms (median)`,
        async () => {
            findCalls++;
            const result = await measureFind(binary, fixture, {
                timeoutMs: log500m.timeoutMs,
                typed: FIND_TYPED,
                gapMs: 100,
            });
            firstMatchSamples.push(result.firstMatchMs);
            findKeySamples.push(...result.keyMs);
            keysDuringWalk.push(result.keysDuringWalk);
            if (findCalls === STEP_RUNS) {
                checkBudgets(
                    "find",
                    [
                        { label: "first match", values: firstMatchSamples, budget: FIND_FIRST_MATCH_BUDGET_MS },
                        { label: "key during the walk", values: findKeySamples, budget: FIND_KEY_BUDGET_MS },
                    ],
                    `keys typed while a walk ran: [${keysDuringWalk.join(", ")}] of ${String(FIND_TYPED.length)} a run`,
                );
            }
        },
        { iterations: STEP_RUNS, time: 0, warmupIterations: 0, warmupTime: 0 },
    );

    const editableSamples: number[] = [];
    const loadKeySamples: number[] = [];
    const editKeySamples: WorkloadStepResult[] = [];
    let editingCalls = 0;
    bench(
        `log500m: Enable Editing ≤ ${String(EDITABLE_BUDGET_MS)} ms, key during the load ≤ ${String(LOAD_KEY_BUDGET_MS)} ms, after it ≤ ${String(EDIT_KEY_BUDGET_MS)} ms (median)`,
        async () => {
            editingCalls++;
            const result = await measureEnableEditing(binary, fixture, {
                timeoutMs: log500m.timeoutMs,
                editCycles: EDIT_CYCLES,
                gapMs: 100,
            });
            editableSamples.push(result.editableMs);
            loadKeySamples.push(...result.loadKeyMs);
            editKeySamples.push(...result.editKeys);
            if (editingCalls === STEP_RUNS) {
                // The last run of the last bench (`gateFixtureDir`: no afterAll in bench mode).
                removeTempDir(fixtureDir);
                const latency = (keys: readonly WorkloadStepKey[]): number[] =>
                    editKeySamples.filter((w) => keys.includes(w.key)).map((w) => w.latencyMs ?? Number.NaN);
                checkBudgets("Enable Editing", [
                    { label: "to editable", values: editableSamples, budget: EDITABLE_BUDGET_MS },
                    { label: "ArrowDown during the load", values: loadKeySamples, budget: LOAD_KEY_BUDGET_MS },
                    {
                        label: "edit keys after it",
                        values: latency(["insert", "enter", "undoEnter", "undoInsert"]),
                        budget: EDIT_KEY_BUDGET_MS,
                    },
                ]);
            }
        },
        { iterations: STEP_RUNS, time: 0, warmupIterations: 0, warmupTime: 0 },
    );
});
