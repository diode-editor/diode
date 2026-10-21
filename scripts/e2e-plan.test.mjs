// Run: node --test scripts/ (npm run test:scripts).
import assert from "node:assert/strict";
import { test } from "node:test";

import { analyzeReport, planWorkers, renderSummary, verdict } from "./e2e-plan.mjs";

const GiB = 1024 ** 3;
const machine = (over = {}) => ({ cpus: 16, totalBytes: 64 * GiB, constrainedBytes: 0, availableBytes: 60 * GiB, env: {}, ...over });

test("planWorkers: on a big idle machine, capped by half the cores", () => {
    assert.equal(planWorkers(machine()).workers, 8);
});

test("planWorkers: this machine (4 CPU, 7.6 GB, 5 GB free) gets two workers", () => {
    const plan = planWorkers(machine({ cpus: 4, totalBytes: 7.6 * GiB, availableBytes: 5 * GiB }));
    assert.equal(plan.workers, 2);
    assert.match(plan.reason, /cores 4\/2 → 2; memory 7\.6 GB − 2\.0 → 3; free 5\.0 GB − 1\.0 → 2/);
});

test("planWorkers: many cores, little memory, capped by memory", () => {
    assert.equal(planWorkers(machine({ totalBytes: 8 * GiB })).workers, 4); // (8−2)/1.5
});

test("planWorkers: a machine busy with a neighbor, sized by free memory", () => {
    assert.equal(planWorkers(machine({ availableBytes: 4 * GiB })).workers, 2); // (4−1)/1.5
});

test("planWorkers: a cgroup limit below machine memory is used instead", () => {
    assert.equal(planWorkers(machine({ constrainedBytes: 5 * GiB })).workers, 2); // (5−2)/1.5
    // "no limit" is a huge number: not below machine memory, so ignored
    assert.equal(planWorkers(machine({ constrainedBytes: 2 ** 64 })).workers, 8);
});

test("planWorkers: not enough for anything, still one", () => {
    assert.equal(planWorkers(machine({ cpus: 1, availableBytes: 0.5 * GiB })).workers, 1);
});

test("planWorkers: DIODE_E2E_WORKERS skips the calculation; garbage → 1", () => {
    assert.deepEqual(planWorkers(machine({ env: { DIODE_E2E_WORKERS: "3" } })), { workers: 3, reason: "DIODE_E2E_WORKERS=3" });
    assert.equal(planWorkers(machine({ env: { DIODE_E2E_WORKERS: "0" } })).workers, 1);
    assert.equal(planWorkers(machine({ env: { DIODE_E2E_WORKERS: "abc" } })).workers, 1);
    assert.equal(planWorkers(machine({ env: { DIODE_E2E_WORKERS: "" } })).workers, 8);
});

test("planWorkers: without arguments, uses the real machine", () => {
    assert.ok(planWorkers().workers >= 1);
});

const report = {
    testResults: [
        { name: "/repo/e2e/ok.test.ts", status: "passed", assertionResults: [{ fullName: "ok", status: "passed" }] },
        {
            name: "/repo/e2e/flaky.test.ts",
            status: "failed",
            assertionResults: [
                { fullName: "suite a", status: "passed" },
                { fullName: "suite b", status: "failed", failureMessages: ["\nError: timed out after 30000ms\n    at x"] },
            ],
        },
        { name: "/repo/e2e/broken.test.ts", status: "failed", message: "Error: Cannot find module\nstack", assertionResults: [] },
    ],
};

test("analyzeReport: failed files with their tests; a wholly failed file with its cause", () => {
    assert.deepEqual(analyzeReport(report, "/repo"), {
        files: 3,
        failed: [
            { file: "e2e/flaky.test.ts", tests: [{ name: "suite b", message: "Error: timed out after 30000ms" }] },
            { file: "e2e/broken.test.ts", tests: [{ name: "(whole file)", message: "Error: Cannot find module" }] },
        ],
    });
    assert.deepEqual(analyzeReport({}, "/repo"), { files: 0, failed: [] });
});

test("verdict: a flake fails in the first and passes in the second; a breakage fails in both", () => {
    const first = analyzeReport(report, "/repo");
    const second = { failed: [{ file: "e2e/broken.test.ts" }] };
    const result = verdict(first, second);
    assert.equal(result.ok, false);
    assert.deepEqual(result.flaky.map((f) => f.file), ["e2e/flaky.test.ts"]);
    assert.deepEqual(result.broken.map((f) => f.file), ["e2e/broken.test.ts"]);

    assert.equal(verdict(first, { failed: [] }).ok, true);
    assert.equal(verdict({ failed: [] }, null).ok, true);
    assert.deepEqual(verdict(first, null), { ok: false, flaky: [], broken: first.failed });
});

test("renderSummary: status, FLAKY and FAILED with the list of tests", () => {
    const first = analyzeReport(report, "/repo");
    const text = renderSummary(verdict(first, { failed: [{ file: "e2e/broken.test.ts" }] }), {
        files: 3,
        workers: 2,
        retried: true,
        wallSeconds: 61.4,
    });
    assert.match(text, /^### e2e: RED\n\n3 files, workers 2, 61 s; failed files rerun one by one\n/);
    assert.match(text, /\*\*FLAKY: failed in the first pass, green in the second\*\* \(1\):\n\n- `e2e\/flaky\.test\.ts`\n {2}- suite b — Error: timed out/);
    assert.match(text, /\*\*FAILED\*\* \(1\):\n\n- `e2e\/broken\.test\.ts`\n {2}- \(whole file\) — Error: Cannot find module/);

    assert.equal(renderSummary(verdict(first, { failed: [] }), { files: 3, workers: 1, retried: true, wallSeconds: 1 }).split("\n")[0], "### e2e: green, with flakes");
    const clean = renderSummary(verdict({ failed: [] }, null), { files: 3, workers: 1, retried: false, wallSeconds: 1 });
    assert.equal(clean, "### e2e: green\n\n3 files, workers 1, 1 s\n");
});
