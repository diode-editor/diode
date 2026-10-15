// Запуск: node --test scripts/ (npm run test:scripts).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { SNAPSHOT_BUILD_FLAGS, SNAPSHOT_ENTRY, snapshotEntryEnv } from "./build-lazy-chunks.mjs";

// Синтетический main.cjs: функция, которую при сборке никто не зовёт, и вход
// после десериализации, который её зовёт и печатает то, что видит main.cjs.
const MAIN = `
function probeNeverCalledAtBuild(x) {
    return x * 2 + 1;
}
require("node:v8").startupSnapshot.setDeserializeMainFunction(() => {
    console.log(JSON.stringify({
        probe: probeNeverCalledAtBuild(20),
        filename: typeof __filename,
        dirname: typeof __dirname,
        builtin: typeof require("node:path").join,
    }));
});
`;

function withDir(fn) {
    const dir = mkdtempSync(join(tmpdir(), "diode-snapshot-entry-test-"));
    try {
        return fn(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

function buildBlob(dir, { entry, env = {} }) {
    const blob = join(dir, `${String(Math.random()).slice(2)}.blob`);
    const result = spawnSync(
        process.execPath,
        [...SNAPSHOT_BUILD_FLAGS, "--snapshot-blob", blob, "--build-snapshot", entry],
        {
            cwd: dir,
            env: { ...process.env, ...env },
            encoding: "utf8",
        },
    );
    return { blob, result };
}

/** Запуск из блоба с логом функций: вывод и строки ленивой компиляции `probeNeverCalledAtBuild`. */
function runWithFunctionLog(dir, blob) {
    const log = join(dir, `${String(Math.random()).slice(2)}.log`);
    const result = spawnSync(
        process.execPath,
        ["--snapshot-blob", blob, "--log-function-events", `--logfile=${log}`, "--no-logfile-per-isolate"],
        { cwd: dir, encoding: "utf8" },
    );
    const lazyCompiles = readFileSync(log, "utf8")
        .split("\n")
        .filter(
            (line) => /^function,(parse-function|interpreter),/.test(line) && line.endsWith(",probeNeverCalledAtBuild"),
        );
    return { stdout: result.stdout.trim(), lazyCompiles };
}

test("вход снапшота: main.cjs скомпилирован при сборке — у пользователя функция не компилируется лениво", () => {
    withDir((dir) => {
        const mainPath = join(dir, "main.cjs");
        writeFileSync(mainPath, MAIN);

        const eager = buildBlob(dir, { entry: SNAPSHOT_ENTRY, env: snapshotEntryEnv(mainPath) });
        assert.equal(eager.result.status, 0, eager.result.stderr);
        const lazy = buildBlob(dir, { entry: mainPath });
        assert.equal(lazy.result.status, 0, lazy.result.stderr);

        const fromEager = runWithFunctionLog(dir, eager.blob);
        const fromLazy = runWithFunctionLog(dir, lazy.blob);
        // main.cjs видит то же, что дал бы ему сборщик снапшота напрямую.
        assert.deepEqual(JSON.parse(fromEager.stdout), {
            probe: 41,
            filename: "string",
            dirname: "string",
            builtin: "function",
        });
        assert.equal(fromEager.stdout, fromLazy.stdout);
        // Контроль: без входа та же функция компилируется лениво у пользователя.
        assert.notEqual(fromLazy.lazyCompiles.length, 0);
        assert.deepEqual(fromEager.lazyCompiles, []);
    });
});

test("вход снапшота: без пути к main.cjs сборка падает с понятной ошибкой", () => {
    withDir((dir) => {
        const { result } = buildBlob(dir, { entry: SNAPSHOT_ENTRY, env: { DIODE_SNAPSHOT_MAIN: "" } });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /DIODE_SNAPSHOT_MAIN/);
    });
});
