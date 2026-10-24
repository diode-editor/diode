import { bench, describe } from "vitest";

import { removeTempDir } from "../helpers/appSession.ts";
import { getBinaryPath } from "../helpers/buildOnce.ts";

import { gateFixtureDir, generateFixture, SIZES } from "./openFixtures.ts";
import { COLS, measureOpenOnce, ROWS } from "./openMeasure.ts";
import { measureFloorPty, NODE_FLOOR_ARGS } from "./ptyFloor.ts";
import { median } from "./stats.ts";

// Perf gate for our startup overhead: the public number in docs/public/BENCH-OPEN.md must be guarded
// by a test. `npm run test:perf` runs under a lease; in CI it is the `npm run test:perf:startup` step of the
// `e2e (ubuntu-latest)` job, which is also what the calibration is based on.
//
// Calibration (2026-10-16): CI median is 99 ms of ours (IQR 16). The budget is doubled so the shared runner
// does not flake: it catches regressions on the scale of "lost the snapshot" (+60…90 ms). Locally it is ~170 ms
// of ours — may hit the budget; CI is authoritative here.
//
// Vitest bench has no budgets: an exception thrown from the bench function fails the file with a nonzero code.

/** Median over `small` samples. */
export const STARTUP_BUDGET_OURS_MS = 200;
const SAMPLES = 5;

// NB: fixtures and the floor live at module top level: in `vitest bench` mode a heavy
// beforeAll misbehaves (the bench collects no samples).
const binary = await getBinaryPath();
const fixtureDir = gateFixtureDir("diode-perf-open");
const small = SIZES.find((s) => s.key === "small");
if (small === undefined) throw new Error("size matrix has no small");
const fixture = await generateFixture(fixtureDir, small);
const floorOptions = { cols: COLS, rows: ROWS, runs: 5 };
const nodeFloorMs = (await measureFloorPty(process.execPath, NODE_FLOOR_ARGS, floorOptions)).medianMs;

const samples: number[] = [];
let calls = 0;

describe("Startup: our cost over the node floor (SEA in PTY, small)", () => {
    bench(
        `small: to text − node floor ≤ ${String(STARTUP_BUDGET_OURS_MS)} ms (median)`,
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
                throw new Error(`file did not open: ${result.outcome} (exit ${String(result.exitCode)})`);
            }
            // The first call is tinybench's warmup iteration (FS cache) and is excluded from the stats.
            if (calls === 1) return;
            samples.push(result.contentMs - nodeFloorMs);
            if (samples.length === SAMPLES) {
                // The last sample: the fixture is not needed any more (`gateFixtureDir`: no afterAll in bench mode).
                removeTempDir(fixtureDir);
                const ours = median(samples);
                const detail = `node floor ${String(Math.round(nodeFloorMs))} ms, samples [${samples.map((v) => String(Math.round(v))).join(", ")}]`;
                if (ours > STARTUP_BUDGET_OURS_MS) {
                    throw new Error(
                        `our ms over the node floor: ${String(Math.round(ours))} > budget ${String(STARTUP_BUDGET_OURS_MS)} (${detail})`,
                    );
                }
                console.error(`[perf] small: our ${String(Math.round(ours))} ms over the node floor (${detail})`);
            }
        },
        { iterations: SAMPLES, time: 0, warmupIterations: 1, warmupTime: 0 },
    );
});
