// Run: node --test scripts/ (npm run test:scripts); not part of the product vitest suite.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
    ensureJsonReporter,
    filterReportToScope,
    mutantKey,
    parseArgs,
    parseDiff,
    parseScope,
    PositionalArgumentError,
    scoreReport,
} from "./mutation-gate.mjs";

const at = (line, column, endLine, endColumn) => ({ start: { line, column }, end: { line: endLine, column: endColumn } });

test("parseArgs: base only via flag, npm script flags in front do not interfere", () => {
    const parsed = parseArgs(["--ignoreStatic", "--incremental", "--base", "origin/main", "--concurrency", "4"]);
    assert.equal(parsed.base, "origin/main");
    assert.deepEqual(parsed.strykerArgs, ["--ignoreStatic", "--incremental", "--concurrency", "4"]);
    assert.equal(parseArgs(["--base=abc123"]).base, "abc123");
    assert.equal(parseArgs([]).base, null);
});

test("parseArgs: a positional argument is an error with a hint, not a silent main base", () => {
    // Exactly what `npm run test:mutation -- X` produced.
    assert.throws(() => parseArgs(["--ignoreStatic", "--incremental", "feature"]), /--base feature/);
    assert.throws(() => parseArgs(["feature"]), /positional/);
    assert.throws(() => parseArgs(["--scope-only", "feature"]), /positional/);
    assert.throws(() => parseArgs(["--concurrency=4", "feature"]), /positional/);
    assert.throws(() => parseArgs(["--base"]), /requires a revision/);
    assert.throws(() => parseArgs(["--base", "--force"]), /requires a revision/);
});

test("parseArgs: a positional argument has its own error class, which the bash-guard hook refuses on before the run", () => {
    assert.throws(
        () => parseArgs(["--incremental", "feature"]),
        (error) => error instanceof PositionalArgumentError && error.arg === "feature",
    );
    // Other argument errors are not it: the hook stays silent on them, the gate itself reports them.
    assert.throws(
        () => parseArgs(["--base"]),
        (error) => !(error instanceof PositionalArgumentError),
    );
    assert.throws(
        () => parseArgs(["--verify-jobs", "x"]),
        (error) => !(error instanceof PositionalArgumentError),
    );
});

test("parseArgs: --scope-only is consumed and not passed to Stryker", () => {
    const parsed = parseArgs(["--scope-only", "--force"]);
    assert.equal(parsed.scopeOnly, true);
    assert.deepEqual(parsed.strykerArgs, ["--force"]);
});

test("ensureJsonReporter: appends json if missing", () => {
    assert.deepEqual(ensureJsonReporter(["--reporters", "html,clear-text"]), ["--reporters", "html,clear-text,json"]);
    assert.deepEqual(ensureJsonReporter(["--reporters=html"]), ["--reporters=html,json"]);
    assert.deepEqual(ensureJsonReporter(["--reporters", "json,html"]), ["--reporters", "json,html"]);
    assert.deepEqual(ensureJsonReporter(["--force"]), ["--force"]);
});

test("mutantKey: two replacements at one position are different mutants", () => {
    const location = at(10, 5, 10, 20);
    const toTrue = { location, mutatorName: "ConditionalExpression", replacement: "true" };
    const toFalse = { location, mutatorName: "ConditionalExpression", replacement: "false" };
    assert.notEqual(mutantKey("a.ts", toTrue), mutantKey("a.ts", toFalse));
    const shorter = { ...toTrue, location: at(10, 5, 10, 12) };
    assert.notEqual(mutantKey("a.ts", toTrue), mutantKey("a.ts", shorter));
    assert.equal(mutantKey("a.ts", toTrue), mutantKey("a.ts", { ...toTrue }));
});

test("parseScope + filterReportToScope: foreign mutants from incremental mode are dropped", () => {
    const scope = parseScope(["src/new.ts", "src/old.ts:10-20"]);
    const report = {
        files: {
            "src/new.ts": { mutants: [{ location: at(500, 1, 500, 2), status: "Survived" }] },
            "src/old.ts": {
                mutants: [
                    { location: at(10, 1, 20, 1), status: "Survived" },
                    { location: at(19, 1, 21, 1), status: "Survived" }, // crosses the edge: out of scope, as in Stryker
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

test("scoreReport: Stryker's formula, RuntimeError/CompileError/Ignored are outside the denominator", () => {
    const mutants = ["Killed", "Timeout", "Survived", "NoCoverage", "RuntimeError", "CompileError", "Ignored"].map(
        (status) => ({ status }),
    );
    const { score, valid, detected } = scoreReport({ files: { "a.ts": { mutants } } });
    assert.equal(detected, 2);
    assert.equal(valid, 4);
    assert.equal(score, 50);
    assert.equal(scoreReport({ files: { "a.ts": { mutants: [{ status: "RuntimeError" }] } } }).score, 100);
});

test("parseArgs: injection re-verification flags are consumed and not passed to Stryker", () => {
    const parsed = parseArgs(["--incremental", "--verify-jobs", "2", "--verify-full", "--verify-timeout", "30", "--verify-budget", "15"]);
    assert.deepEqual(parsed.verify, { jobs: 2, full: true, timeoutMs: 30_000, budgetMs: 900_000 });
    assert.deepEqual(parsed.strykerArgs, ["--incremental"]);
    assert.deepEqual(parseArgs([]).verify, {});
    assert.throws(() => parseArgs(["--verify-jobs"]), /positive number/);
    assert.throws(() => parseArgs(["--verify-budget", "x"]), /positive number/);
});

test("parseDiff: hunks keep both sides, pure deletions and /dev/null are skipped", () => {
    const diff = [
        "diff --git src/a.ts src/a.ts",
        "--- src/a.ts",
        "+++ src/a.ts",
        "@@ -3 +3 @@ x",
        "-old",
        "+new",
        "@@ -10,2 +9,0 @@",
        "@@ -20,0 +18,3 @@",
        "--- src/gone.ts",
        "+++ /dev/null",
        "@@ -1,2 +0,0 @@",
    ].join("\n");
    const { scope, headers } = parseDiff(diff);
    assert.equal(headers, 2);
    assert.deepEqual(scope.get("src/a.ts"), [
        { oldStart: 3, oldCount: 1, newStart: 3, newCount: 1 },
        { oldStart: 20, oldCount: 0, newStart: 18, newCount: 3 },
    ]);
    assert.equal(scope.has("src/gone.ts"), false);
});
