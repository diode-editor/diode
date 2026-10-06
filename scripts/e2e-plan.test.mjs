// Запуск: node --test scripts/ (npm run test:scripts).
import assert from "node:assert/strict";
import { test } from "node:test";

import { analyzeReport, planWorkers, renderSummary, verdict } from "./e2e-plan.mjs";

const GiB = 1024 ** 3;
const machine = (over = {}) => ({ cpus: 16, totalBytes: 64 * GiB, constrainedBytes: 0, availableBytes: 60 * GiB, env: {}, ...over });

test("planWorkers: на большой тихой машине упирается в половину ядер", () => {
    assert.equal(planWorkers(machine()).workers, 8);
});

test("planWorkers: эта машина (4 CPU, 7,6 ГБ, 5 ГБ свободно) — два воркера", () => {
    const plan = planWorkers(machine({ cpus: 4, totalBytes: 7.6 * GiB, availableBytes: 5 * GiB }));
    assert.equal(plan.workers, 2);
    assert.match(plan.reason, /ядра 4\/2 → 2; память 7\.6 ГБ − 2\.0 → 3; свободно 5\.0 ГБ − 1\.0 → 2/);
});

test("planWorkers: много ядер, мало памяти — упирается в память", () => {
    assert.equal(planWorkers(machine({ totalBytes: 8 * GiB })).workers, 4); // (8−2)/1,5
});

test("planWorkers: занятая соседом машина — по свободной памяти", () => {
    assert.equal(planWorkers(machine({ availableBytes: 4 * GiB })).workers, 2); // (4−1)/1,5
});

test("planWorkers: лимит cgroup меньше памяти машины — считаем от него", () => {
    assert.equal(planWorkers(machine({ constrainedBytes: 5 * GiB })).workers, 2); // (5−2)/1,5
    // «без лимита» — огромное число: не меньше памяти машины, игнорируется
    assert.equal(planWorkers(machine({ constrainedBytes: 2 ** 64 })).workers, 8);
});

test("planWorkers: ни на что не хватает — всё равно один", () => {
    assert.equal(planWorkers(machine({ cpus: 1, availableBytes: 0.5 * GiB })).workers, 1);
});

test("planWorkers: DIODE_E2E_WORKERS — без расчёта; мусор → 1", () => {
    assert.deepEqual(planWorkers(machine({ env: { DIODE_E2E_WORKERS: "3" } })), { workers: 3, reason: "DIODE_E2E_WORKERS=3" });
    assert.equal(planWorkers(machine({ env: { DIODE_E2E_WORKERS: "0" } })).workers, 1);
    assert.equal(planWorkers(machine({ env: { DIODE_E2E_WORKERS: "abc" } })).workers, 1);
    assert.equal(planWorkers(machine({ env: { DIODE_E2E_WORKERS: "" } })).workers, 8);
});

test("planWorkers: без аргументов — от настоящей машины", () => {
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

test("analyzeReport: упавшие файлы с тестами; упавший целиком файл — с причиной", () => {
    assert.deepEqual(analyzeReport(report, "/repo"), {
        files: 3,
        failed: [
            { file: "e2e/flaky.test.ts", tests: [{ name: "suite b", message: "Error: timed out after 30000ms" }] },
            { file: "e2e/broken.test.ts", tests: [{ name: "(файл целиком)", message: "Error: Cannot find module" }] },
        ],
    });
    assert.deepEqual(analyzeReport({}, "/repo"), { files: 0, failed: [] });
});

test("verdict: флак — упал в первом, прошёл во втором; поломка — упал в обоих", () => {
    const first = analyzeReport(report, "/repo");
    const second = { failed: [{ file: "e2e/broken.test.ts" }] };
    const result = verdict(first, second);
    assert.equal(result.ok, false);
    assert.deepEqual(result.flaky.map((f) => f.file), ["e2e/flaky.test.ts"]);
    assert.deepEqual(result.broken.map((f) => f.file), ["e2e/broken.test.ts"]);

    assert.equal(verdict(first, { failed: [] }).ok, true);
    assert.equal(verdict({ failed: [] }, null).ok, true);
    // второго прохода не было — всё упавшее красное
    assert.deepEqual(verdict(first, null), { ok: false, flaky: [], broken: first.failed });
});

test("renderSummary: статус, FLAKY и FAILED со списком тестов", () => {
    const first = analyzeReport(report, "/repo");
    const text = renderSummary(verdict(first, { failed: [{ file: "e2e/broken.test.ts" }] }), {
        files: 3,
        workers: 2,
        retried: true,
        wallSeconds: 61.4,
    });
    assert.match(text, /^### e2e: КРАСНЫЙ\n\n3 файлов, воркеров 2, 61 с; упавшие файлы перепрогнаны поодиночке\n/);
    assert.match(text, /\*\*FLAKY — упал в первом проходе, зелёный во втором\*\* \(1\):\n\n- `e2e\/flaky\.test\.ts`\n {2}- suite b — Error: timed out/);
    assert.match(text, /\*\*FAILED\*\* \(1\):\n\n- `e2e\/broken\.test\.ts`\n {2}- \(файл целиком\) — Error: Cannot find module/);

    assert.equal(renderSummary(verdict(first, { failed: [] }), { files: 3, workers: 1, retried: true, wallSeconds: 1 }).split("\n")[0], "### e2e: зелёный, с флаками");
    const clean = renderSummary(verdict({ failed: [] }, null), { files: 3, workers: 1, retried: false, wallSeconds: 1 });
    assert.equal(clean, "### e2e: зелёный\n\n3 файлов, воркеров 1, 1 с\n");
});
