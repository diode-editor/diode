// Run: node --test scripts/ (npm run test:scripts).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ALLOWED_TOP_LEVEL, auditTopLevel, findBakedEnvironment } from "./check-snapshot.mjs";

/** Synthetic bundle: modules with esbuild markers and a snapshot entry, like main.cjs. */
function bundle(dir, modules) {
    const body = Object.entries(modules)
        .map(([path, code]) => `// ${path}\n${code}\n`)
        .join("");
    const file = join(dir, "main.cjs");
    writeFileSync(file, `${body}require("node:v8").startupSnapshot.setDeserializeMainFunction(() => {});\n`);
    return file;
}

function withDir(fn) {
    const dir = mkdtempSync(join(tmpdir(), "diode-snapshot-check-test-"));
    try {
        return fn(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

const sub = (dir, name) => {
    const path = join(dir, name);
    mkdirSync(path, { recursive: true });
    return path;
};

test("clean module top level: environment reads inside functions do not trip the gate", () => {
    withDir((dir) => {
        const mainPath = bundle(dir, {
            "src/vs/good.ts": [
                "const os = require(\"node:os\");",
                "globalThis.paths = { home: () => os.homedir(), term: () => process.env.TERM, now: () => Date.now() };",
            ].join("\n"),
        });
        assert.deepEqual(auditTopLevel({ mainPath, workDir: sub(dir, "audit") }), []);
        assert.deepEqual(findBakedEnvironment({ mainPath, workDir: sub(dir, "poison") }).leaks, []);
    });
});

test("constant from the environment: the trap names the module, the poisoned build finds the mark in the blob", () => {
    withDir((dir) => {
        const mainPath = bundle(dir, {
            "src/vs/good.ts": "globalThis.ok = 1;",
            "src/vs/bad.ts": [
                "const HOME = require(\"node:os\").homedir();",
                "const TERM = process.env.TERM;",
                "globalThis.baked = () => [HOME, TERM];",
            ].join("\n"),
        });
        const findings = auditTopLevel({ mainPath, workDir: sub(dir, "audit") });
        assert.deepEqual(
            findings.map((f) => [f.what, f.module, f.allowed]),
            [
                ["os.homedir()", "src/vs/bad.ts", false],
                ["process.env.TERM", "src/vs/bad.ts", false],
            ],
        );
        const leaked = findBakedEnvironment({ mainPath, workDir: sub(dir, "poison") }).leaks.map((l) => l.value);
        assert.deepEqual(leaked.sort(), ["home", "term"]);
    });
});

test("lazy singleton woken at build time: the build cwd is baked in", () => {
    withDir((dir) => {
        const mainPath = bundle(dir, {
            "src/vs/lazy.ts": [
                "let root;",
                "const workspaceRoot = () => (root ??= require(\"node:path\").resolve(\".\"));",
                "globalThis.root = workspaceRoot;",
                "workspaceRoot();",
            ].join("\n"),
        });
        const findings = auditTopLevel({ mainPath, workDir: sub(dir, "audit") });
        assert.deepEqual(
            findings.map((f) => [f.what, f.module]),
            [["process.cwd()", "src/vs/lazy.ts"]],
        );
        const leaked = findBakedEnvironment({ mainPath, workDir: sub(dir, "poison") }).leaks.map((l) => l.value);
        assert.deepEqual(leaked, ["cwd"]);
    });
});

test("time, randomness and a timer at the module top level are violations", () => {
    withDir((dir) => {
        const mainPath = bundle(dir, {
            "src/vs/clock.ts": [
                "const started = Date.now();",
                "const sessionId = Math.random().toString(36);",
                "setTimeout(() => {}, 0);",
                "globalThis.clock = () => [started, sessionId];",
            ].join("\n"),
        });
        const findings = auditTopLevel({ mainPath, workDir: sub(dir, "audit") });
        assert.deepEqual(
            findings.map((f) => f.what),
            ["Date.now()", "Math.random()", "setTimeout()"],
        );
    });
});

test("a native object at the module top level (Intl.Segmenter) fails the snapshot build", () => {
    withDir((dir) => {
        const mainPath = bundle(dir, {
            "src/vs/native.ts": [
                "const segmenter = new Intl.Segmenter(undefined, { granularity: \"grapheme\" });",
                "globalThis.split = (s) => [...segmenter.segment(s)];",
            ].join("\n"),
        });
        assert.throws(() => auditTopLevel({ mainPath, workDir: sub(dir, "audit") }), /failed to build/);
    });
});

test("module top level exceptions have a reason", () => {
    for (const allowed of ALLOWED_TOP_LEVEL) {
        assert.ok(allowed.why.length > 20, `${allowed.what}: a reason is required`);
        assert.match(allowed.module, /^(src|node_modules)\//);
    }
});
