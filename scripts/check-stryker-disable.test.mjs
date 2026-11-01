// Run: node --test scripts/ (npm run test:scripts).
import assert from "node:assert/strict";
import { test } from "node:test";

import { DEAD_CODE_REASON, deadCodeMarkers, inScope } from "./check-stryker-disable.mjs";

test("deadCodeMarkers: a reason about unreachable code is caught with its 1-based line", () => {
    const text = [
        "const a = 1;",
        "// Stryker disable next-line ConditionalExpression: the guard is for the type, nodes.get(undefined) is undefined",
        "if (x) {}",
        "    // Stryker disable next-line OptionalChaining,EqualityOperator: unreachable — see above",
    ].join("\n");
    assert.deepEqual(deadCodeMarkers(text), [
        { line: 2, reason: "the guard is for the type, nodes.get(undefined) is undefined" },
        { line: 4, reason: "unreachable — see above" },
    ]);
});

test("deadCodeMarkers: a block marker without next-line counts too", () => {
    const text = "// Stryker disable ArrowFunction,BlockStatement: defensive wiring\nf();\n// Stryker restore ArrowFunction,BlockStatement";
    assert.deepEqual(deadCodeMarkers(text), [{ line: 1, reason: "defensive wiring" }]);
});

test("deadCodeMarkers: an equivalent mutant with an honest reason is not a dead-code marker", () => {
    const text = [
        "// Stryker disable next-line EqualityOperator: at the boundary both arms give the same end",
        "// Stryker disable next-line StringLiteral: the string is only a debug label",
        "// Stryker disable next-line CallExpression: killing an already exited process is harmless — a dead process ignores signals",
        "// Stryker restore EqualityOperator",
        "// not a marker: unreachable",
    ].join("\n");
    assert.deepEqual(deadCodeMarkers(text), []);
});

test("DEAD_CODE_REASON: every phrasing of the list, case-insensitive", () => {
    for (const reason of [
        "Unreachable branch",
        "the branch is not reachable",
        "`?.` is defensive",
        "the null check is for the type",
        "never happens in the app",
        "the value is never null here",
        "`delta` is never zero",
        "an upstream branch that is dead with our regex",
        "dead code after the early return",
        "cannot happen: both are set together",
        "can't happen, see above",
    ]) {
        assert.equal(DEAD_CODE_REASON.test(reason), true, reason);
    }
    assert.equal(DEAD_CODE_REASON.test("a deadline of 5 s"), false);
    assert.equal(DEAD_CODE_REASON.test("drops the reference to a dead map"), false);
});

test("inScope: sources under src/ without tests and declarations", () => {
    assert.equal(inScope("src/vs/base/common/uri.ts"), true);
    assert.equal(inScope("src/vs/base/common/uri.test.ts"), false);
    assert.equal(inScope("src/vscode-dts/vscode.d.ts"), false);
    assert.equal(inScope("extensions/foo/src/extension.ts"), false);
    assert.equal(inScope("scripts/check-diff.mjs"), false);
});
