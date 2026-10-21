#!/usr/bin/env node
/**
 * Gate on the core V8 snapshot (`npm run snapshot-check`). The module top level of
 * `dist/main.cjs` runs once, at build time on CI: any environment it reads is baked in and
 * silently lies on the user's machine, while the snapshot build fails only on native objects.
 * Rules: docs/arch/Common.md, the module top level and V8 snapshot section.
 *
 *  1. Traps (`snapshot-audit-prelude.cjs`): reads of the environment, time, randomness
 *     and timers at the module top level; exceptions are {@link ALLOWED_TOP_LEVEL}.
 *  2. Poisoned build: marks in the node path, cwd, env and argv; the blob holds no more marks
 *     than an empty snapshot of the same node (which itself stores `execPath` and `argv`).
 *  3. The same blob in a clean environment: `--version`, the extensions CLI and run-as-node see
 *     the launch environment.
 *
 * No SEA: the heap is the same, and the binary (seconds and hundreds of MB) is not needed.
 *
 *   node scripts/check-snapshot.mjs                 # build main.cjs into a temp directory (tsup)
 *   node scripts/check-snapshot.mjs --main <path>   # check a ready main.cjs
 */

import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { SNAPSHOT_BUILD_FLAGS, SNAPSHOT_ENTRY, snapshotEntryEnv } from "./build-lazy-chunks.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const PRELUDE = join(import.meta.dirname, "snapshot-audit-prelude.cjs");

/**
 * @type {ReadonlyArray<{ what: string, module: string, why: string }>}
 */
export const ALLOWED_TOP_LEVEL = [
    {
        what: "process.env.VSCODE_TEXTMATE_DEBUG",
        module: "node_modules/vscode-textmate/release/main.js",
        why: "a debug flag of a third-party package (DebugFlags.InDebugMode): unset at build time and baked as false; users cannot enable textmate debugging via env, which is fine",
    },
];

/** Latin letters with a digit: a one-byte string shows up in the blob as is (UTF-16LE is searched separately). */
const MARKS = {
    cwd: "Zq7snapCwd",
    execPath: "Zq7snapExec",
    home: "Zq7snapHome",
    tmp: "Zq7snapTmp",
    xdg: "Zq7snapXdg",
    path: "Zq7snapPath",
    term: "Zq7snapTerm",
    lang: "Zq7snapLang",
    user: "Zq7snapUser",
    argv: "Zq7snapArgv",
    env: "Zq7snapEnv",
};

function poisonedEnv() {
    const env = {
        PATH: `${join("/", MARKS.path)}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
        HOME: join("/", MARKS.home),
        USERPROFILE: join("/", MARKS.home),
        TMPDIR: join("/", MARKS.tmp),
        TMP: join("/", MARKS.tmp),
        TEMP: join("/", MARKS.tmp),
        XDG_CONFIG_HOME: join("/", MARKS.xdg, "config"),
        XDG_CACHE_HOME: join("/", MARKS.xdg, "cache"),
        XDG_DATA_HOME: join("/", MARKS.xdg, "data"),
        XDG_STATE_HOME: join("/", MARKS.xdg, "state"),
        XDG_RUNTIME_DIR: join("/", MARKS.xdg, "run"),
        APPDATA: join("/", MARKS.xdg, "appdata"),
        LOCALAPPDATA: join("/", MARKS.xdg, "localappdata"),
        TERM: MARKS.term,
        COLORTERM: MARKS.term,
        TERM_PROGRAM: MARKS.term,
        LANG: MARKS.lang,
        LC_ALL: MARKS.lang,
        USER: MARKS.user,
        LOGNAME: MARKS.user,
        USERNAME: MARKS.user,
        SHELL: join("/", MARKS.user, "sh"),
        EDITOR: MARKS.env,
        TMUX: MARKS.env,
        COLUMNS: "7",
        LINES: "7",
    };
    // Without SystemRoot, Windows cannot even start node.
    for (const key of ["SystemRoot", "SYSTEMROOT", "windir"]) {
        if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    return env;
}

/** The only build V8 flags are {@link SNAPSHOT_BUILD_FLAGS}, as in build-sea. */
function cleanEnv(extra = {}) {
    const env = { ...process.env, ...extra };
    delete env.NODE_OPTIONS;
    return env;
}

function buildSnapshot({ node, entry, blob, cwd, env, extraArgs = [] }) {
    const result = spawnSync(node, [...SNAPSHOT_BUILD_FLAGS, "--snapshot-blob", blob, "--build-snapshot", entry, ...extraArgs], {
        cwd,
        env,
        encoding: "utf8",
    });
    if (result.status !== 0) {
        throw new Error(
            `snapshot ${basename(entry)} failed to build (code ${String(result.status)}, signal ${String(result.signal)}):\n` +
                stripSnapshotWarnings(result.stderr ?? ""),
        );
    }
    return result.stderr ?? "";
}

/** Builtin module warnings appear on every build, so they are noise. */
function stripSnapshotWarnings(stderr) {
    return stderr
        .split("\n")
        .filter(
            (line) =>
                !/not yet fully verified|may still work in some cases|request support for the module|--trace-warnings/.test(line),
        )
        .join("\n")
        .trim();
}

/** esbuild writes `// <path>` before every bundle module. */
function moduleIndex(source) {
    const lines = source.split("\n");
    const starts = [];
    lines.forEach((line, index) => {
        const match = /^\/\/ ((?:src|node_modules)\/\S+)$/.exec(line);
        if (match) starts.push({ line: index + 1, module: match[1] });
    });
    return (line) => {
        let found = "?";
        for (const start of starts) {
            if (start.line > line) break;
            found = start.module;
        }
        return found;
    };
}

/**
 * @param {{ mainPath: string, workDir: string, node?: string }} params
 * @returns {Array<{ what: string, module: string, line: number, code: string, allowed: boolean }>}
 */
export function auditTopLevel({ mainPath, workDir, node = process.execPath }) {
    const prelude = readFileSync(PRELUDE, "utf8");
    const main = readFileSync(mainPath, "utf8");
    const preludeLines = prelude.split("\n").length - 1;
    const entry = join(workDir, "audit-entry.cjs");
    const report = join(workDir, "audit.json");
    writeFileSync(entry, prelude + main);
    buildSnapshot({
        node,
        entry,
        blob: join(workDir, "audit.blob"),
        cwd: workDir,
        env: cleanEnv({ DIODE_SNAPSHOT_AUDIT_OUT: report }),
    });
    const hits = /** @type {Array<{ what: string, stack: string[] }>} */ (JSON.parse(readFileSync(report, "utf8")));
    const lines = main.split("\n");
    const moduleAt = moduleIndex(main);
    const entryFrame = new RegExp(`${escapeRegExp(entry)}:(\\d+):\\d+`);
    /** @type {Map<string, { what: string, module: string, line: number, code: string, allowed: boolean }>} */
    const found = new Map();
    for (const { what, stack } of hits) {
        // Node frames between the trap and the bundle are either our call (`path.resolve` reads cwd)
        // or node internals (warnings, the module loader), which are skipped.
        const index = stack.findIndex((f, i) => {
            if (i === 0) return false;
            const match = entryFrame.exec(f);
            return match !== null && Number(match[1]) > preludeLines;
        });
        if (index === -1) continue;
        const frame = stack[index];
        if (stack.slice(1, index).some((f) => /internal\/process\/warning|internal\/main\/mksnapshot|internal\/modules\//.test(f))) {
            continue;
        }
        const line = Number(entryFrame.exec(frame)?.[1]) - preludeLines;
        const module = moduleAt(line);
        const key = `${what}\u0000${module}\u0000${String(line)}`;
        if (found.has(key)) continue;
        const allowed = ALLOWED_TOP_LEVEL.some((a) => a.what === what && a.module === module);
        found.set(key, { what, module, line, code: (lines[line - 1] ?? "").trim().slice(0, 120), allowed });
    }
    return [...found.values()];
}

/**
 * @param {{ mainPath: string, workDir: string }} params
 * @returns {{ leaks: Array<{ mark: string, value: string, inMain: number, inEmpty: number }>, blob: string, node: string }}
 */
export function findBakedEnvironment({ mainPath, workDir }) {
    // The build execPath is environment too (in SEA it is the binary itself).
    const nodeDir = join(workDir, MARKS.execPath);
    mkdirSync(nodeDir, { recursive: true });
    const node = join(nodeDir, basename(process.execPath));
    copyFileSync(process.execPath, node);
    chmodSync(node, 0o755);
    const cwd = join(workDir, MARKS.cwd);
    mkdirSync(cwd, { recursive: true });
    const env = poisonedEnv();

    const empty = join(workDir, "empty.cjs");
    writeFileSync(empty, 'require("node:v8").startupSnapshot.setDeserializeMainFunction(() => {});\n');
    const emptyBlob = join(workDir, "empty.blob");
    const mainBlob = join(workDir, "main.blob");
    buildSnapshot({ node, entry: empty, blob: emptyBlob, cwd, env, extraArgs: [MARKS.argv] });
    buildSnapshot({
        node,
        entry: SNAPSHOT_ENTRY,
        blob: mainBlob,
        cwd,
        env: { ...env, ...snapshotEntryEnv(mainPath) },
        extraArgs: [MARKS.argv],
    });

    const count = (bytes, mark) => {
        const text = bytes.toString("latin1");
        return text.split(mark).length - 1 + (text.split(Buffer.from(mark, "utf16le").toString("latin1")).length - 1);
    };
    const emptyBytes = readFileSync(emptyBlob);
    const mainBytes = readFileSync(mainBlob);
    const leaks = [];
    for (const [value, mark] of Object.entries(MARKS)) {
        const inMain = count(mainBytes, mark);
        const inEmpty = count(emptyBytes, mark);
        if (inMain > inEmpty) leaks.push({ mark, value, inMain, inEmpty });
    }
    return { leaks, blob: mainBlob, node };
}

/**
 * Plain `process.execPath`, not the node from the marked directory: otherwise the runtime
 * path in an error text would look like a leak.
 *
 * @param {{ mainPath: string, blob: string, workDir: string }} params
 * @returns {string[]}
 */
export function checkDeserializedBehaviour({ mainPath, blob, workDir }) {
    const node = process.execPath;
    const problems = [];
    const runHome = join(workDir, "run-home");
    const runTmp = join(workDir, "run-tmp");
    const runCwd = join(workDir, "run-cwd");
    for (const dir of [runHome, runTmp, runCwd]) mkdirSync(dir, { recursive: true });
    const runEnv = cleanEnv({
        HOME: runHome,
        USERPROFILE: runHome,
        TMPDIR: runTmp,
        TMP: runTmp,
        TEMP: runTmp,
        XDG_CONFIG_HOME: join(runHome, ".config"),
        XDG_CACHE_HOME: join(runHome, ".cache"),
        XDG_DATA_HOME: join(runHome, ".local", "share"),
        APPDATA: join(runHome, "AppData", "Roaming"),
        LOCALAPPDATA: join(runHome, "AppData", "Local"),
    });
    // `plain` runs without the snapshot: the reference output to compare against.
    const run = (args, extraEnv = {}, { plain = false } = {}) =>
        spawnSync(node, [...(plain ? [] : ["--snapshot-blob", blob]), mainPath, ...args], {
            cwd: runCwd,
            env: { ...runEnv, ...extraEnv },
            encoding: "utf8",
            timeout: 30_000,
        });
    const probe = (name, args, expected) => {
        const fromSnapshot = run(args, { DIODE_RUN_AS_NODE: "1" });
        const plain = run(args, { DIODE_RUN_AS_NODE: "1" }, { plain: true });
        if (fromSnapshot.status !== 0) problems.push(`${name}: ${describe(fromSnapshot)}`);
        else if (fromSnapshot.stdout !== plain.stdout) {
            problems.push(`${name}: from snapshot ${fromSnapshot.stdout}, without snapshot ${plain.stdout}`);
        } else if (fromSnapshot.stdout !== JSON.stringify(expected)) {
            problems.push(`${name}: sees ${fromSnapshot.stdout}, expected ${JSON.stringify(expected)}`);
        }
        return fromSnapshot;
    };
    const describe = (r) => `code ${String(r.status)}, stdout ${JSON.stringify(r.stdout)}, stderr ${JSON.stringify(stripSnapshotWarnings(r.stderr ?? ""))}`;
    const marked = (text) => Object.values(MARKS).filter((mark) => text.includes(mark));

    const version = run(["--version"]);
    if (version.status !== 0 || version.stdout.trim() === "") problems.push(`--version: ${describe(version)}`);

    const list = run(["--list-extensions"]);
    if (list.status !== 0) problems.push(`--list-extensions: ${describe(list)}`);
    else if (readdirSync(runHome).length === 0) {
        problems.push("--list-extensions did not create user data in the launch HOME; is the directory baked in at build time?");
    }

    const evalCode =
        'const os = require("node:os"); process.stdout.write(JSON.stringify({ cwd: process.cwd(), home: os.homedir(), ' +
        'tmp: os.tmpdir(), argv: process.argv.slice(1), filename: __filename, module: typeof module, ' +
        'path: typeof require("node:path").join }));';
    const evalRun = probe("run-as-node -e", ["-e", evalCode, "arg-1"], {
        cwd: runCwd,
        home: runHome,
        tmp: runTmp,
        argv: ["arg-1"],
        filename: join(runCwd, "[eval]"),
        module: "object",
        path: "function",
    });

    // Like a language server. `require.main === module` is false even without the snapshot:
    // the script is loaded by import() of a synthetic module (importModule.ts).
    const scriptDir = join(workDir, "script");
    mkdirSync(scriptDir, { recursive: true });
    writeFileSync(join(scriptDir, "dep.cjs"), "module.exports = 42;\n");
    const script = join(scriptDir, "server.cjs");
    writeFileSync(
        script,
        'process.stdout.write(JSON.stringify({ dep: require("./dep.cjs"), main: require.main === module, ' +
            "argv: process.argv.slice(1), filename: __filename, cwd: process.cwd() }));\n",
    );
    const scriptRun = probe("run-as-node script", [script, "--stdio"], {
        dep: 42,
        main: false,
        argv: [script, "--stdio"],
        filename: script,
        cwd: runCwd,
    });

    // Like pyright background analysis: node before 26.11 from a user snapshot aborted with SIGABRT
    // on the first `stream_wrap` in a worker (nodejs/node#65978).
    const workerScript = join(scriptDir, "worker.cjs");
    writeFileSync(
        workerScript,
        'const { Worker } = require("node:worker_threads");\n' +
            'const w = new Worker(\'require("node:net"); require("node:v8"); require("node:worker_threads").parentPort.postMessage("ok")\', { eval: true });\n' +
            "w.on(\"message\", (m) => { process.stdout.write(JSON.stringify({ worker: m })); process.exit(0); });\n",
    );
    const workerRun = probe("run-as-node worker with node:net", [workerScript], { worker: "ok" });

    for (const [name, r] of [
        ["run-as-node worker", workerRun],
        ["--version", version],
        ["--list-extensions", list],
        ["run-as-node -e", evalRun],
        ["run-as-node script", scriptRun],
    ]) {
        const leaked = marked(`${r.stdout ?? ""}${r.stderr ?? ""}`);
        if (leaked.length > 0) problems.push(`${name}: build environment in the output (${leaked.join(", ")})`);
    }
    return problems;
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildMain(outDir) {
    const tsupCli = join(repoRoot, "node_modules", "tsup", "dist", "cli-default.js");
    execFileSync(process.execPath, [tsupCli, "--out-dir", outDir, "--silent"], { stdio: "inherit", cwd: repoRoot });
    return join(outDir, "main.cjs");
}

async function main() {
    const { values } = parseArgs({ options: { main: { type: "string" } } });
    const workDir = mkdtempSync(join(tmpdir(), "diode-snapshot-check-"));
    let failed = false;
    try {
        const mainPath = values.main === undefined ? buildMain(join(workDir, "dist")) : resolve(values.main);
        if (!existsSync(mainPath)) throw new Error(`missing ${mainPath}`);

        const findings = auditTopLevel({ mainPath, workDir: mkdirIn(workDir, "audit") });
        const violations = findings.filter((f) => !f.allowed);
        for (const f of findings.filter((f) => f.allowed)) console.log(`  allowed: ${f.what} — ${f.module}`);
        if (violations.length > 0) {
            failed = true;
            console.error("Module top level reads the environment, which the snapshot build bakes in:");
            for (const v of violations) console.error(`  ${v.what} — ${v.module} (main.cjs:${String(v.line)}): ${v.code}`);
        }

        const poisonDir = mkdirIn(workDir, "poison");
        const { leaks, blob } = findBakedEnvironment({ mainPath, workDir: poisonDir });
        if (leaks.length > 0) {
            failed = true;
            console.error("Build environment is baked into the snapshot heap (marks in the blob beyond an empty snapshot):");
            for (const l of leaks) console.error(`  ${l.value}: ${l.mark} — ${String(l.inMain)} vs ${String(l.inEmpty)}`);
        }

        const problems = checkDeserializedBehaviour({ mainPath, blob, workDir: mkdirIn(workDir, "run") });
        if (problems.length > 0) {
            failed = true;
            console.error("After deserialization the snapshot behaves differently than on the user's machine:");
            for (const p of problems) console.error(`  ${p}`);
        }

        if (failed) {
            console.error("Module top level rules: docs/arch/Common.md, the module top level and V8 snapshot section.");
            process.exitCode = 1;
        } else {
            console.log("Core snapshot builds; build environment is not baked in; after deserialization it sees the launch environment.");
        }
    } finally {
        rmSync(workDir, { recursive: true, force: true });
    }
}

function mkdirIn(parent, name) {
    const dir = join(parent, name);
    mkdirSync(dir, { recursive: true });
    return dir;
}

if (process.argv[1] === import.meta.filename) await main();
