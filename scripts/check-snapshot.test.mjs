// Запуск: node --test scripts/ (npm run test:scripts).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ALLOWED_TOP_LEVEL, auditTopLevel, findBakedEnvironment } from "./check-snapshot.mjs";

/** Синтетический бандл: модули с маркерами esbuild и вход снапшота, как у main.cjs. */
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

test("чистый верхний уровень: чтения окружения внутри функций гейт не трогают", () => {
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

test("константа из окружения: ловушка называет модуль, отравленная сборка находит метку в блобе", () => {
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

test("ленивый синглтон, разбуженный при сборке: cwd сборки запечён", () => {
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

test("время, случайность и таймер на верхнем уровне — нарушения", () => {
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

test("нативный объект на верхнем уровне (Intl.Segmenter) роняет сборку снапшота", () => {
    withDir((dir) => {
        const mainPath = bundle(dir, {
            "src/vs/native.ts": [
                "const segmenter = new Intl.Segmenter(undefined, { granularity: \"grapheme\" });",
                "globalThis.split = (s) => [...segmenter.segment(s)];",
            ].join("\n"),
        });
        assert.throws(() => auditTopLevel({ mainPath, workDir: sub(dir, "audit") }), /не собрался/);
    });
});

test("исключения верхнего уровня — с причиной", () => {
    for (const allowed of ALLOWED_TOP_LEVEL) {
        assert.ok(allowed.why.length > 20, `${allowed.what}: причина обязательна`);
        assert.match(allowed.module, /^(src|node_modules)\//);
    }
});
