// Run: node --test scripts/ (npm run test:scripts).
import assert from "node:assert/strict";
import { test } from "node:test";

import { checkFile } from "./check-comments-only.mjs";

const MIT = [
    "/*---------------------------------------------------------------------------------------------",
    " *  Copyright (c) Microsoft Corporation. All rights reserved.",
    " *--------------------------------------------------------------------------------------------*/",
];

test("a removed comment passes", () => {
    assert.deepEqual(checkFile("a.ts", "// why\nconst a = 1; // how\n", "const a = 1;\n"), []);
});

test("a changed token fails and names the line", () => {
    assert.deepEqual(checkFile("a.ts", "const a = 1;\nconst b = 2;\n", "const a = 1;\nconst b = 3;\n"), [
        "a.ts: code changed, not only comments (line 2, `3`)",
    ]);
});

test("prettier collapsing a literal after its comment is removed is not a code change", () => {
    const before = 'expect(x).toEqual([\n    "a", //\n    "b",\n]);\nconst o = {\n    a: 1, // one\n    b: 2,\n};\n';
    const after = 'expect(x).toEqual(["a", "b"]);\nconst o = { a: 1, b: 2 };\n';
    assert.deepEqual(checkFile("a.ts", before, after), []);
});

test("a type literal losing its last separator on collapse is not a code change", () => {
    assert.deepEqual(checkFile("a.ts", "type T = {\n    a: string; // x\n    b: number;\n};\n", "type T = { a: string; b: number };\n"), []);
});

test("an elision is not a trailing comma", () => {
    assert.equal(checkFile("a.ts", "const a = [,];\n", "const a = [];\n").length, 1);
});

test("a lost marker fails", () => {
    assert.deepEqual(checkFile("a.ts", "// Stryker disable next-line all: why\nconst a = 1;\n", "const a = 1;\n"), [
        "a.ts: marker ^Stryker (?:disable|restore) — was 1, now 0",
    ]);
});

test("a file with the vendored banner in its header is a verbatim copy", () => {
    const before = [...MIT, "//@diode:vendored microsoft/vscode@1.0.0 src/a.ts", "// x", "const a = 1;", ""].join("\n");
    assert.deepEqual(checkFile("src/a.ts", before, before.replace("// x\n", "")), [
        "src/a.ts: verbatim upstream copy — not edited by hand",
    ]);
});

test("the banner as a literal outside the header does not make a file vendored", () => {
    const before = '#!/usr/bin/env node\n// tool\nconst b = [\n    `//@diode:vendored ${tag}`, // banner\n];\n';
    assert.deepEqual(checkFile("scripts/import.mjs", before, before.replace(" // banner", "")), []);
});

test("--no-cyrillic flags a Russian comment left behind", () => {
    // Escapes, not literals: this file is itself under the ratchet.
    const ru = "\u043f\u0440\u0438\u0432\u0435\u0442"; // "privet"
    assert.deepEqual(checkFile("a.ts", `// ${ru}\nconst a = 1;\n`, `// ${ru}\nconst a = 1;\n`, { noCyrillic: true }), [
        `a.ts: 1 comment lines still in Russian, e.g. "${ru}"`,
    ]);
});
