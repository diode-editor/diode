// Run: node --test scripts/ (npm run test:scripts).
import assert from "node:assert/strict";
import { test } from "node:test";

import { codeTokens, isVendored } from "./code-tokens.mjs";

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

