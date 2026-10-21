// End-to-end test of the gate self-check on a synthetic project: real vitest,
// real sandbox, one mutant per class. Run: npm run test:scripts.
import assert from "node:assert/strict";
import {
    existsSync,
    mkdtempSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, test } from "node:test";

import { mutantKey } from "./mutation-gate.mjs";
import { mergeVerdicts } from "./mutation-inject.mjs";
import { verifyMutants } from "./verify-mutants.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");

const FILES = {
    "src/calc.ts": `export function isPositive(x: number): boolean {
    return x > 0;
}

export function guard(v: unknown): string {
    if (typeof v !== "object" || v === null) return "no";
    return "yes";
}

export function later(cb: () => void): void {
    setTimeout(() => cb(), 0);
}

export function count(n: number): number {
    let i = 0;
    while (i < n) i++;
    return i;
}
`,
    "src/calc.test.ts": `import { expect, test } from "vitest";
import { count, guard, isPositive, later } from "./calc.js";

test("isPositive", () => {
    expect(isPositive(5)).toBe(true);
    expect(isPositive(-5)).toBe(false);
});

// Exactly case #343: the test cannot tell "left operand removed" from "whole condition intact".
test("guard", () => {
    expect(guard(null)).toBe("no");
    expect(guard({})).toBe("yes");
});

test("later", async () => {
    later(() => {});
    await new Promise((resolve) => setTimeout(resolve, 20));
});

test("count", () => {
    expect(count(3)).toBe(3);
});
`,
    // A file without its own tests: only the test importing the wrapper checks it.
    "src/deep.ts": `export function twice(x: number): number {
    return x * 2;
}
`,
    "src/wrap.ts": `import { twice } from "./deep.js";

export function quad(x: number): number {
    return twice(twice(x));
}
`,
    "src/wrap.test.ts": `import { expect, test } from "vitest";
import { quad } from "./wrap.js";

test("quad", () => {
    expect(quad(1)).toBe(4);
});
`,
    // The test is red without the mutant too: such a set gives no verdict.
    "src/broken.ts": `export const answer = 42;
`,
    "src/broken.test.ts": `import { expect, test } from "vitest";
import { answer } from "./broken.js";

test("answer", () => {
    expect(answer).toBe(43);
});
`,
};

/** Substring position in Stryker style: 1-based line and column, the end is past the last character. */
function locate(source, snippet, from = 0) {
    const at = source.indexOf(snippet, from);
    assert.ok(at >= 0, `"${snippet}" not found in the source`);
    const pos = (offset) => {
        const before = source.slice(0, offset).split("\n");
        return { line: before.length, column: before.at(-1).length + 1 };
    };
    return { start: pos(at), end: pos(at + snippet.length) };
}

let root;
let verdicts;
let report;

function mutant(id, file, snippet, mutatorName, replacement, extra = {}) {
    return {
        id,
        mutatorName,
        replacement,
        status: "Survived",
        testsCompleted: 0,
        location: locate(FILES[file], snippet),
        ...extra,
    };
}

before(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "verify-mutants-"));
    for (const [file, text] of Object.entries(FILES)) {
        mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
        writeFileSync(path.join(root, file), text);
    }
    symlinkSync(path.join(repoRoot, "node_modules"), path.join(root, "node_modules"), "dir");

    const calc = FILES["src/calc.ts"];
    report = {
        files: {
            "src/calc.ts": {
                source: calc,
                mutants: [
                    // Boundary `>` → `>=`: the tests never pass 0, a real hole with an "equivalent?" hint.
                    mutant("real-boundary", "src/calc.ts", "x > 0", "EqualityOperator", "x >= 0"),
                    // Stryker "lost" the run (coveredBy is empty), yet a test kills it.
                    mutant("phantom", "src/calc.ts", "x > 0", "ConditionalExpression", "false"),
                    // The left operand of `||` is NOT the whole condition: with the tests above the hole is real.
                    mutant(
                        "real-left-operand",
                        "src/calc.ts",
                        'typeof v !== "object"',
                        "ConditionalExpression",
                        "false",
                    ),
                    // The listener throws in a timer: the test is green, vitest is red.
                    mutant("runtime", "src/calc.ts", "cb()", "CallExpression", "null.x()", { status: "RuntimeError" }),
                    // A synchronous infinite loop: no test gets to finish.
                    mutant("hang", "src/calc.ts", "i++", "UpdateOperator", "i--"),
                ],
            },
            "src/deep.ts": {
                source: FILES["src/deep.ts"],
                // No coveredBy and no sibling test: only the wrapper's test kills it, via the import graph.
                mutants: [
                    mutant("via-graph", "src/deep.ts", "x * 2", "ArithmeticOperator", "x / 2", {
                        status: "NoCoverage",
                    }),
                ],
            },
            "src/broken.ts": {
                source: FILES["src/broken.ts"],
                mutants: [mutant("red-baseline", "src/broken.ts", "42", "NumberLiteral", "41")],
            },
            "src/wrap.ts": {
                // The report was taken from another version of the file: the coordinates cannot be trusted.
                source: FILES["src/wrap.ts"].replace("twice(twice(x))", "twice(x) * 2"),
                mutants: [mutant("stale", "src/wrap.ts", "twice", "StringLiteral", '""')],
            },
        },
        testFiles: {},
    };
    verdicts = await verifyMutants({ root, report, timeoutMs: 10_000, log: () => {} });
});

after(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
});

const byId = (id) => {
    for (const [file, data] of Object.entries(report.files)) {
        const found = data.mutants.find((m) => m.id === id);
        if (found !== undefined) return verdicts.find((v) => v.key === mutantKey(file, found));
    }
    throw new Error(id);
};

test("a real survivor is real; the boundary operator is flagged as an equivalence candidate", () => {
    const verdict = byId("real-boundary");
    assert.equal(verdict.class, "real");
    assert.match(verdict.hint, /boundary/);
});

test("phantom: a test green without the mutant fails with it, phantom with the test name", () => {
    const verdict = byId("phantom");
    assert.equal(verdict.class, "phantom");
    assert.ok(verdict.tests.some((name) => name.includes("src/calc.test.ts > isPositive")));
});

test("injects exactly the left operand of `||`, not the whole condition (#343)", () => {
    assert.equal(byId("real-left-operand").class, "real");
});

test("a mutant crashing vitest outside tests is runtime-error", () => {
    const verdict = byId("runtime");
    assert.equal(verdict.class, "runtime-error");
    assert.match(verdict.reason, /Unhandled|TypeError/);
});

test("a hang is timeout, not phantom", () => {
    assert.equal(byId("hang").class, "timeout");
});

test("the import graph catches a test selection miss", () => {
    const verdict = byId("via-graph");
    assert.equal(verdict.class, "phantom");
    assert.equal(verdict.stage, "import graph");
});

test("a test red without the mutant too is inconclusive", () => {
    const verdict = byId("red-baseline");
    assert.equal(verdict.class, "inconclusive");
    assert.match(verdict.reason, /without the mutant/);
});

test("a source different from the report is stale", () => {
    assert.equal(byId("stale").class, "stale");
});

test("the working tree is untouched, the sandbox is removed", () => {
    for (const [file, text] of Object.entries(FILES))
        assert.equal(readFileSync(path.join(root, file), "utf8"), text, file);
    const sandboxes = path.join(root, ".stryker-tmp");
    assert.deepEqual(existsSync(sandboxes) ? readdirSync(sandboxes) : [], []);
});

test("verdicts are merged into the report: phantom → Killed, runtime-error → RuntimeError, real keeps its class", () => {
    const merged = mergeVerdicts(structuredClone(report), verdicts);
    const calc = merged.files["src/calc.ts"].mutants;
    const get = (id) => calc.find((m) => m.id === id);
    assert.equal(get("phantom").status, "Killed");
    assert.match(get("phantom").statusReason, /verified by injection/);
    assert.equal(get("runtime").status, "RuntimeError");
    assert.equal(get("real-boundary").status, "Survived");
    assert.equal(get("real-boundary").verification.class, "real");
});
