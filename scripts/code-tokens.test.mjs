// Run: node --test scripts/ (npm run test:scripts).
import assert from "node:assert/strict";
import { test } from "node:test";

import { changedCodeRanges, codeTokens, isVendored } from "./code-tokens.mjs";

const hunk = (oldStart, oldCount, newStart, newCount) => ({ oldStart, oldCount, newStart, newCount });

test("codeTokens: comments and layout are not tokens, a trailing separator is dropped", () => {
    const texts = (src) => codeTokens("a.ts", src).map((t) => t.text);
    assert.deepEqual(texts("const a = [\n    1, // one\n    2,\n];\n"), texts("const a = [1, 2];"));
});

test("codeTokens: a multi-line token spans its lines", () => {
    const t = codeTokens("a.ts", "const a = `x\ny`;\n").find((x) => x.text.startsWith("`"));
    assert.deepEqual([t.start, t.end], [1, 2]);
});

test("isVendored: the banner counts only in the leading comments", () => {
    assert.equal(isVendored("/* MIT */\n//@diode:vendored microsoft/vscode@1 a.ts\nx;\n"), true);
    assert.equal(isVendored("#!/usr/bin/env node\n//@diode:vendored microsoft/vscode@1 a.ts\n"), true);
    assert.equal(isVendored("x;\n//@diode:vendored microsoft/vscode@1 a.ts\n"), false);
    assert.equal(isVendored("const b = `//@diode:vendored ${tag}`;\n"), false);
});

test("changedCodeRanges: a line that only lost its trailing comment drops out", () => {
    const before = "a();\nb(); // why\nc();\n";
    const after = "a();\nb();\nc();\n";
    assert.deepEqual(changedCodeRanges("a.ts", before, after, [hunk(2, 1, 2, 1)]), []);
});

test("changedCodeRanges: in a hunk of code and comment lines only the code line stays", () => {
    const before = "a(); // one\nb(1); // two\nc(); // three\n";
    const after = "a();\nb(2);\nc();\n";
    assert.deepEqual(changedCodeRanges("a.ts", before, after, [hunk(1, 3, 1, 3)]), [[2, 2]]);
});

test("changedCodeRanges: prettier collapsing a literal is not a code change", () => {
    const before = "x([\n    1, //\n    2,\n]);\n";
    const after = "x([1, 2]);\n";
    assert.deepEqual(changedCodeRanges("a.ts", before, after, [hunk(1, 4, 1, 1)]), []);
});

test("changedCodeRanges: a deletion keeps the line of its neighbours", () => {
    const before = "if (a && b) f();\n";
    const after = "if (a) f();\n";
    assert.deepEqual(changedCodeRanges("a.ts", before, after, [hunk(1, 1, 1, 1)]), [[1, 1]]);
});

test("changedCodeRanges: added lines stay, adjacent lines merge into one range", () => {
    const before = "a();\n";
    const after = "a();\nb();\nc();\n";
    assert.deepEqual(changedCodeRanges("a.ts", before, after, [hunk(1, 0, 2, 2)]), [[2, 3]]);
});

test("changedCodeRanges: a token changed inside a multi-line string is clipped to the hunk", () => {
    const before = "const s = `a\nb\nc`;\n";
    const after = "const s = `a\nB\nc`;\n";
    assert.deepEqual(changedCodeRanges("a.ts", before, after, [hunk(2, 1, 2, 1)]), [[2, 2]]);
});
