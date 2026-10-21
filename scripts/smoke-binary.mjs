/**
 * Self-test of the built binary: it must **actually start**.
 *
 * No shebang on purpose: vitest on Windows inlines the file via an esbuild transform
 * that does NOT strip the shebang, and `#!` fails in ESM as a SyntaxError.
 *
 * Lesson #143: a segfault gives `error === undefined`, `status === null`, and checking only
 * `result.error` let a broken asset into a release. Hence both `signal` and `status` are checked.
 * `--version` is the only path that exits on its own without a TTY; it runs before
 * `createDefaultAssetAccess()`, so a broken `diode.bundle` is caught by e2e, not the self-test.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * @param {string} binaryPath
 * @param {{ timeoutMs?: number, cwd?: string }} [options]
 * @returns {string}
 */
export function smokeTestBinary(binaryPath, options = {}) {
    const { timeoutMs = 30_000, cwd } = options;
    const result = spawnSync(binaryPath, ["--version"], {
        timeout: timeoutMs,
        stdio: "pipe",
        encoding: "utf8",
        ...(cwd !== undefined ? { cwd } : {}),
    });

    if (result.error) {
        throw new Error(`[smoke] Binary cannot be executed (${result.error.code ?? "?"}): ${result.error.message}`);
    }
    if (result.signal !== null) {
        throw new Error(
            `[smoke] Binary crashed with signal ${result.signal} — it does not start at all.\n` +
                `${describeOutput(result)}`,
        );
    }
    if (result.status !== 0) {
        throw new Error(`[smoke] Binary exited with code ${String(result.status)}, expected 0.\n${describeOutput(result)}`);
    }

    const version = (result.stdout ?? "").trim();
    if (version === "") {
        throw new Error(`[smoke] Binary printed no version on stdout.\n${describeOutput(result)}`);
    }
    return version;
}

/** @param {{ stdout?: string, stderr?: string }} result */
function describeOutput(result) {
    return `  stdout: ${JSON.stringify(result.stdout ?? "")}\n  stderr: ${JSON.stringify(result.stderr ?? "")}`;
}

/**
 * The embedded language server relies on node mode. Both loading paths: CJS, and `import()`
 * of ESM with top-level await from an external CJS shim (the SEA embedder hook catches only
 * imports from the embedded main, runAsNode.ts).
 *
 * @param {string} binaryPath
 * @param {{ timeoutMs?: number }} [options]
 */
export function smokeTestNodeMode(binaryPath, options = {}) {
    const { timeoutMs = 30_000 } = options;
    const dir = mkdtempSync(join(tmpdir(), "diode-smoke-node-"));
    try {
        writeFileSync(
            join(dir, "inner.mjs"),
            'await new Promise((r) => setTimeout(r, 1));\nconsole.log("SMOKE-ESM-TLA-OK");\n',
        );
        writeFileSync(
            join(dir, "probe.cjs"),
            '"use strict";\nconsole.log("SMOKE-CJS-OK");\nconst { pathToFileURL } = require("node:url");\nconst { join } = require("node:path");\nimport(pathToFileURL(join(__dirname, "inner.mjs")).href).catch((e) => { console.error(e); process.exit(1); });\n',
        );
        const result = spawnSync(binaryPath, [join(dir, "probe.cjs")], {
            timeout: timeoutMs,
            stdio: "pipe",
            encoding: "utf8",
            env: { ...process.env, DIODE_RUN_AS_NODE: "1" },
        });
        if (result.error) {
            throw new Error(`[smoke:node] cannot execute (${result.error.code ?? "?"}): ${result.error.message}`);
        }
        if (result.signal !== null || result.status !== 0) {
            throw new Error(
                `[smoke:node] exited status=${String(result.status)} signal=${String(result.signal)}.\n` +
                    describeOutput(result),
            );
        }
        const out = result.stdout ?? "";
        if (!out.includes("SMOKE-CJS-OK") || !out.includes("SMOKE-ESM-TLA-OK")) {
            throw new Error(`[smoke:node] unexpected output.\n${describeOutput(result)}`);
        }

        // A user serverPath = cli.mjs: no external CJS shim.
        const direct = spawnSync(binaryPath, [join(dir, "inner.mjs")], {
            timeout: timeoutMs,
            stdio: "pipe",
            encoding: "utf8",
            env: { ...process.env, DIODE_RUN_AS_NODE: "1" },
        });
        if (direct.status !== 0 || !(direct.stdout ?? "").includes("SMOKE-ESM-TLA-OK")) {
            throw new Error(
                `[smoke:node] direct ESM-TLA load failed status=${String(direct.status)}.\n${describeOutput(direct)}`,
            );
        }

        // Like pyright background analysis: node before 26.11 from a V8 snapshot aborted with SIGABRT
        // on the first `stream_wrap` in a worker. The pythonLsp e2e runs only on linux, the self-test everywhere.
        writeFileSync(
            join(dir, "worker.cjs"),
            'const { Worker } = require("node:worker_threads");\n' +
                'const w = new Worker(\'require("node:net"); require("node:v8"); require("node:worker_threads").parentPort.postMessage("SMOKE-WORKER-OK")\', { eval: true });\n' +
                "w.on(\"message\", (m) => { console.log(m); process.exit(0); });\n" +
                "w.on(\"error\", (e) => { console.error(e); process.exit(1); });\n",
        );
        const worker = spawnSync(binaryPath, [join(dir, "worker.cjs")], {
            timeout: timeoutMs,
            stdio: "pipe",
            encoding: "utf8",
            env: { ...process.env, DIODE_RUN_AS_NODE: "1" },
        });
        if (worker.status !== 0 || !(worker.stdout ?? "").includes("SMOKE-WORKER-OK")) {
            throw new Error(
                `[smoke:node] worker thread with node:net failed status=${String(worker.status)} ` +
                    `signal=${String(worker.signal)}.\n${describeOutput(worker)}`,
            );
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}
