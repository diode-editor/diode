// Запуск: node --test scripts/ (npm run test:scripts). Скрипты не входят в
// vitest-сьют продукта — там только src/ и extensions/.
import assert from "node:assert/strict";
import { test } from "node:test";

import { ensureJsonReporter, filterReportToScope, mutantKey, parseArgs, parseScope, scoreReport } from "./mutation-gate.mjs";

const at = (line, column, endLine, endColumn) => ({ start: { line, column }, end: { line: endLine, column: endColumn } });

test("parseArgs: база только флагом, флаги npm-скрипта впереди не мешают", () => {
    const parsed = parseArgs(["--ignoreStatic", "--incremental", "--base", "origin/main", "--concurrency", "4"]);
    assert.equal(parsed.base, "origin/main");
    assert.deepEqual(parsed.strykerArgs, ["--ignoreStatic", "--incremental", "--concurrency", "4"]);
    assert.equal(parseArgs(["--base=abc123"]).base, "abc123");
    assert.equal(parseArgs([]).base, null);
});

test("parseArgs: позиционный аргумент — ошибка с подсказкой, а не тихая база main", () => {
    // Ровно то, что давал `npm run test:mutation -- X`.
    assert.throws(() => parseArgs(["--ignoreStatic", "--incremental", "feature"]), /--base feature/);
    assert.throws(() => parseArgs(["feature"]), /позиционный/);
    assert.throws(() => parseArgs(["--scope-only", "feature"]), /позиционный/);
    assert.throws(() => parseArgs(["--concurrency=4", "feature"]), /позиционный/);
    assert.throws(() => parseArgs(["--base"]), /требует ревизию/);
    assert.throws(() => parseArgs(["--base", "--force"]), /требует ревизию/);
});

test("parseArgs: --scope-only снимается и не уходит Stryker'у", () => {
    const parsed = parseArgs(["--scope-only", "--force"]);
    assert.equal(parsed.scopeOnly, true);
    assert.deepEqual(parsed.strykerArgs, ["--force"]);
});

test("ensureJsonReporter: дописывает json, если его нет", () => {
    assert.deepEqual(ensureJsonReporter(["--reporters", "html,clear-text"]), ["--reporters", "html,clear-text,json"]);
    assert.deepEqual(ensureJsonReporter(["--reporters=html"]), ["--reporters=html,json"]);
    assert.deepEqual(ensureJsonReporter(["--reporters", "json,html"]), ["--reporters", "json,html"]);
    assert.deepEqual(ensureJsonReporter(["--force"]), ["--force"]);
});

test("mutantKey: две замены на одной позиции — разные мутанты", () => {
    const location = at(10, 5, 10, 20);
    const toTrue = { location, mutatorName: "ConditionalExpression", replacement: "true" };
    const toFalse = { location, mutatorName: "ConditionalExpression", replacement: "false" };
    assert.notEqual(mutantKey("a.ts", toTrue), mutantKey("a.ts", toFalse));
    // Тот же старт, другой конец — тоже разные.
    const shorter = { ...toTrue, location: at(10, 5, 10, 12) };
    assert.notEqual(mutantKey("a.ts", toTrue), mutantKey("a.ts", shorter));
    assert.equal(mutantKey("a.ts", toTrue), mutantKey("a.ts", { ...toTrue }));
});

test("parseScope + filterReportToScope: чужие мутанты инкрементального режима выбрасываются", () => {
    const scope = parseScope(["src/new.ts", "src/old.ts:10-20"]);
    const report = {
        files: {
            "src/new.ts": { mutants: [{ location: at(500, 1, 500, 2), status: "Survived" }] },
            "src/old.ts": {
                mutants: [
                    { location: at(10, 1, 20, 1), status: "Survived" }, // целиком внутри
                    { location: at(19, 1, 21, 1), status: "Survived" }, // вылезает за край — как у Stryker'а, вне скоупа
                    { location: at(3, 1, 3, 2), status: "Survived" },
                ],
            },
            "src/foreign.ts": { mutants: [{ location: at(1, 1, 1, 2), status: "Survived" }] },
        },
    };
    assert.equal(filterReportToScope(report, scope), 3);
    assert.deepEqual(Object.keys(report.files), ["src/new.ts", "src/old.ts"]);
    assert.equal(report.files["src/old.ts"].mutants.length, 1);
});

test("scoreReport: формула Stryker'а — RuntimeError/CompileError/Ignored вне знаменателя", () => {
    const mutants = ["Killed", "Timeout", "Survived", "NoCoverage", "RuntimeError", "CompileError", "Ignored"].map(
        (status) => ({ status }),
    );
    const { score, valid, detected } = scoreReport({ files: { "a.ts": { mutants } } });
    assert.equal(detected, 2);
    assert.equal(valid, 4);
    assert.equal(score, 50);
    assert.equal(scoreReport({ files: { "a.ts": { mutants: [{ status: "RuntimeError" }] } } }).score, 100);
});
