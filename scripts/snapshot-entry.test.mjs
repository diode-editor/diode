// Run: node --test scripts/ (npm run test:scripts).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { SNAPSHOT_BUILD_FLAGS, SNAPSHOT_ENTRY, snapshotEntryEnv } from "./build-lazy-chunks.mjs";

// Synthetic main.cjs: a function nobody calls at build time, and a post-deserialization
// entry that calls it and prints what main.cjs sees.
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

test("snapshot entry: main.cjs is compiled at build time, so the function is not compiled lazily at runtime", () => {
    withDir((dir) => {
        const mainPath = join(dir, "main.cjs");
        writeFileSync(mainPath, MAIN);

        const eager = buildBlob(dir, { entry: SNAPSHOT_ENTRY, env: snapshotEntryEnv(mainPath) });
        assert.equal(eager.result.status, 0, eager.result.stderr);
        const lazy = buildBlob(dir, { entry: mainPath });
        assert.equal(lazy.result.status, 0, lazy.result.stderr);

        const fromEager = runWithFunctionLog(dir, eager.blob);
        const fromLazy = runWithFunctionLog(dir, lazy.blob);
        // main.cjs sees the same as the snapshot builder would give it directly.
        assert.deepEqual(JSON.parse(fromEager.stdout), {
            probe: 41,
            filename: "string",
            dirname: "string",
            builtin: "function",
        });
        assert.equal(fromEager.stdout, fromLazy.stdout);
        // Control: otherwise an empty `lazyCompiles` would prove nothing.
        assert.notEqual(fromLazy.lazyCompiles.length, 0);
        assert.deepEqual(fromEager.lazyCompiles, []);
    });
});

test("snapshot entry: without a main.cjs path the build fails with a clear error", () => {
    withDir((dir) => {
        const { result } = buildBlob(dir, { entry: SNAPSHOT_ENTRY, env: { DIODE_SNAPSHOT_MAIN: "" } });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /DIODE_SNAPSHOT_MAIN/);
    });
});
