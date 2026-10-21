// No shebang on purpose: the vite runner loads this module, and on a Windows (CRLF) checkout
// the `#!…\r` line is not stripped, a SyntaxError before the run starts.
/**
 * Immutable e2e binary builds: one directory per source hash in a shared cache.
 *
 *     ~/.cache/diode-e2e/
 *       <key>/              ← finished build, read-only (a-w): diode, diode-selfextract, manifest.json, …
 *       <key>.tmp-<pid>/    ← build in progress; moves to <key>/ by an atomic rename
 *       <key>.lock/owner    ← cross-process lock per key (owner pid)
 *       .in-use/<key>@<pid> ← who is running tests on this build now (eviction leaves it alone)
 *
 * Not the working `dist/`: `tsup clean` of any manual `build:sea` wipes it and neighbor sessions
 * write to it, which caused ENOENT/ETXTBSY mid-run and OOM from extra builds.
 *
 * The key is sha256 of the working-copy blob hashes of {@link BUILD_INPUTS} (not of the git
 * state: amend/squash with the same tree keeps the key), node/platform, version and
 * `node_modules/.package-lock.json` (`engine:link` rewrites it too).
 * The version is pinned to {@link E2E_VERSION}: the usual `nightly-<sha HEAD>` would give
 * a new binary for any docs-only commit.
 *
 * CLI (`e2e/globalSetup.ts` calls the same):
 *     node scripts/e2e-artifacts.mjs          # build/find and print the directory
 *     node scripts/e2e-artifacts.mjs --key    # key only
 *     node scripts/e2e-artifacts.mjs --list   # what the cache holds
 *
 * Variables: `DIODE_E2E_CACHE_DIR` (cache root), `DIODE_E2E_CACHE_KEEP` (how many builds to
 * keep, 3 by default).
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
    chmodSync,
    existsSync,
    lstatSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    rmSync,
    statSync,
    utimesSync,
    writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * NOT semver: without a release version the marketplace `engines.diode` check counts as passed
 * (resolveCompatibleVersion.ts), while a `0.0.0-e2e` stub failed it.
 */
export const E2E_VERSION = "nightly-e2e";

/** Bump when the build directory layout or the order of its steps in this file changes. */
const LAYOUT_VERSION = "1";

/** Git pathspec. Only the scripts that take part in the build. */
export const BUILD_INPUTS = [
    "src",
    "extensions",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "tsup.config.ts",
    "scripts/build-*.mjs",
    "scripts/pack-*.mjs",
    "scripts/selfextract-*",
    "scripts/smoke-binary.mjs",
    "scripts/resolve-version.mjs",
    "scripts/import-meta-url-shim.mjs",
    "scripts/lazy-chunk-code-cache.cjs",
    "scripts/snapshot-entry.cjs",
    // Pathspec without glob magic: `*` matches `/` too.
    ":(exclude)*.test.ts",
    ":(exclude)*.test.mjs",
    ":(exclude)*.test.cjs",
    ":(exclude)*.snap",
];

const DEFAULT_KEEP = 3;
const KEY_RE = /^[0-9a-f]{16}$/;
const MANIFEST = "manifest.json";
/** Wait for a neighbor building the same key (a build on 2 vCPU takes ~3 min). */
const LOCK_WAIT_MS = 20 * 60_000;

const isWindows = process.platform === "win32";
const exe = (name) => (isWindows ? `${name}.exe` : name);

export function cacheRoot(env = process.env) {
    if (env.DIODE_E2E_CACHE_DIR) return resolve(env.DIODE_E2E_CACHE_DIR);
    return join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "diode-e2e");
}

export function buildVersion(env = process.env) {
    return env.DIODE_VERSION?.trim() || E2E_VERSION;
}

/**
 * `null` when the tree is not a git checkout (a source archive): the build goes to a throwaway directory.
 *
 * @param {string} repoRoot
 * @returns {string | null}
 */
export function computeBuildKey(repoRoot, env = process.env) {
    const git = (args, input) =>
        execFileSync("git", args, { cwd: repoRoot, input, maxBuffer: 256 * 1024 * 1024 }).toString();
    let listed;
    try {
        listed = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...BUILD_INPUTS]);
    } catch {
        return null;
    }
    // A deleted but still tracked file is not an input.
    const files = [...new Set(listed.split("\0").filter((p) => p.length > 0))]
        .filter((p) => existsSync(join(repoRoot, p)))
        .sort();
    const blobs = files.length === 0 ? [] : git(["hash-object", "--stdin-paths"], `${files.join("\n")}\n`).trim().split("\n");
    const hash = createHash("sha256");
    hash.update(`layout ${LAYOUT_VERSION}\n`);
    hash.update(`node ${process.version} ${process.platform}-${process.arch}\n`);
    hash.update(`version ${buildVersion(env)}\n`);
    files.forEach((p, i) => hash.update(`${p}\0${blobs[i] ?? ""}\n`));
    const lock = join(repoRoot, "node_modules", ".package-lock.json");
    hash.update(existsSync(lock) ? readFileSync(lock) : "no node_modules lock");
    return hash.digest("hex").slice(0, 16);
}

/** EPERM means someone else's but alive. */
export function isAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return err?.code === "EPERM";
    }
}

function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Windows still holds a `diode.exe` that just ran (the build-sea.mjs self-test), via the image or
 * an antivirus, and renaming its directory fails with EPERM/EBUSY.
 */
function renameWithRetry(from, to) {
    for (let attempt = 0; ; attempt++) {
        try {
            renameSync(from, to);
            return;
        } catch (err) {
            const busy = err?.code === "EPERM" || err?.code === "EBUSY" || err?.code === "EACCES";
            if (!isWindows || !busy || attempt >= 30) throw err;
            sleepSync(500);
        }
    }
}

/**
 * `mkdir` is atomic on every OS and FS; a dead owner's lock is removed.
 *
 * @param {string} lockDir
 * @param {{ waitMs?: number, log?: (msg: string) => void, isProcessAlive?: (pid: number) => boolean }} [options]
 */
export function acquireLock(lockDir, options = {}) {
    const { waitMs = LOCK_WAIT_MS, log = () => {}, isProcessAlive = isAlive } = options;
    const deadline = Date.now() + waitMs;
    let announced = false;
    for (;;) {
        try {
            mkdirSync(lockDir);
            writeFileSync(join(lockDir, "owner"), String(process.pid));
            return () => rmSync(lockDir, { recursive: true, force: true });
        } catch (err) {
            if (err?.code !== "EEXIST") throw err;
        }
        const owner = readOwner(lockDir);
        if (owner === null) {
            // The pid is not written yet, or the owner was killed between mkdir and the write: tell them apart by age.
            if (ageMs(lockDir) > 30_000) rmSync(lockDir, { recursive: true, force: true });
        } else if (!isProcessAlive(owner)) {
            log(`lock ${lockDir} held by dead process ${String(owner)}, removing`);
            rmSync(lockDir, { recursive: true, force: true });
            continue;
        } else if (!announced) {
            log(`process ${String(owner)} is building the same key, waiting for it instead of building twice`);
            announced = true;
        }
        if (Date.now() >= deadline) {
            throw new Error(`[e2e-artifacts] timed out waiting for lock ${lockDir} after ${String(waitMs / 1000)} s`);
        }
        sleepSync(1000);
    }
}

function readOwner(lockDir) {
    try {
        const pid = Number.parseInt(readFileSync(join(lockDir, "owner"), "utf-8").trim(), 10);
        return Number.isInteger(pid) && pid > 0 ? pid : null;
    } catch {
        return null;
    }
}

function ageMs(path) {
    try {
        return Date.now() - statSync(path).mtimeMs;
    } catch {
        return 0;
    }
}

/** `null` when the manifest or any file it lists is missing. */
export function readManifest(dir) {
    try {
        const manifest = JSON.parse(readFileSync(join(dir, MANIFEST), "utf-8"));
        for (const rel of Object.values(manifest.files)) {
            if (!existsSync(join(dir, rel))) return null;
        }
        return manifest;
    } catch {
        return null;
    }
}

/** Makes directories writable first: files in a read-only directory can't be deleted. */
export function removeTree(path) {
    const unlock = (p) => {
        let st;
        try {
            st = lstatSync(p);
        } catch {
            return;
        }
        if (!st.isDirectory()) return;
        try {
            chmodSync(p, 0o755);
        } catch {
            // someone else's, rmSync below reports it
        }
        for (const name of readdirSync(p)) unlock(join(p, name));
    };
    unlock(path);
    rmSync(path, { recursive: true, force: true });
}

function freezeTree(path) {
    if (isWindows) return; // the Windows read-only attribute only gets in the way of cleanup; runners are throwaway
    const st = lstatSync(path);
    if (st.isDirectory()) {
        for (const name of readdirSync(path)) freezeTree(join(path, name));
        chmodSync(path, 0o555);
    } else if (st.isFile()) {
        chmodSync(path, st.mode & 0o111 ? 0o555 : 0o444);
    }
}

/**
 * Keeps the `keep` most recently used builds and everything with a live `.in-use` mark.
 *
 * @returns {string[]} removed paths
 */
export function evict(root, { keep = DEFAULT_KEEP, isProcessAlive = isAlive } = {}) {
    let entries;
    try {
        entries = readdirSync(root);
    } catch {
        return [];
    }
    const removed = [];
    const inUse = new Set();
    const inUseDir = join(root, ".in-use");
    for (const mark of existsSync(inUseDir) ? readdirSync(inUseDir) : []) {
        const [key, pid] = mark.split("@");
        if (isProcessAlive(Number(pid))) inUse.add(key);
        else rmSync(join(inUseDir, mark), { force: true });
    }

    const builds = [];
    for (const name of entries) {
        const path = join(root, name);
        const tmp = /^([0-9a-f]{16})\.tmp-(\d+)$/.exec(name);
        if (tmp !== null) {
            if (!isProcessAlive(Number(tmp[2]))) {
                removeTree(path);
                removed.push(path);
            }
            continue;
        }
        if (KEY_RE.test(name)) builds.push({ name, path, used: statSync(path).mtimeMs });
    }
    builds.sort((a, b) => b.used - a.used);
    for (const build of builds.slice(keep)) {
        if (inUse.has(build.name)) continue;
        removeTree(build.path);
        removed.push(build.path);
    }
    return removed;
}

function buildInto(outDir, { repoRoot, version, log }) {
    const env = { ...process.env, DIODE_VERSION: version, CI: "1" };
    const node = (args) => {
        log(`> node ${args.join(" ")}`);
        // Build output goes to stderr: the run's stdout belongs to the reporters.
        execFileSync(process.execPath, args, { cwd: repoRoot, env, stdio: ["ignore", 2, 2] });
    };
    node([join(repoRoot, "scripts", "build-sea.mjs"), `--dist-dir=${outDir}`]);
    const files = { binary: exe("diode") };
    if (!isWindows) {
        node([
            join(repoRoot, "scripts", "build-selfextract.mjs"),
            "--reuse-dist",
            "--node=host",
            `--dist-dir=${outDir}`,
            `--out=${join(outDir, "diode-selfextract")}`,
        ]);
        files.selfExtract = "diode-selfextract";
        // The payload stage (a copy of node + node_modules) is no longer needed, a hundred MB.
        rmSync(join(outDir, ".selfextract"), { recursive: true, force: true });
    }
    const manifest = {
        version,
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        builtAt: new Date().toISOString(),
        builtFrom: repoRoot,
        files,
    };
    writeFileSync(join(outDir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
}

/**
 * `release()` removes the "in use" mark; the run's teardown calls it.
 *
 * @param {{ repoRoot: string, root?: string, keep?: number, log?: (msg: string) => void }} params
 * @returns {{ key: string | null, dir: string, binary: string, selfExtract: string | undefined, hit: boolean, release: () => void }}
 */
export function ensureE2eArtifacts({ repoRoot, root = cacheRoot(), keep, log = (m) => console.error(`[e2e-artifacts] ${m}`) }) {
    const version = buildVersion();
    const key = computeBuildKey(repoRoot);
    mkdirSync(root, { recursive: true });

    const result = (dir, manifest, hit, release) => ({
        key,
        dir,
        binary: join(dir, manifest.files.binary),
        selfExtract: manifest.files.selfExtract === undefined ? undefined : join(dir, manifest.files.selfExtract),
        hit,
        release,
    });

    if (key === null) {
        // evict removes it by the dead pid.
        const dir = join(root, `${"0".repeat(16)}.tmp-${String(process.pid)}`);
        removeTree(dir);
        log("not a git tree, building without cache");
        const manifest = buildInto(dir, { repoRoot, version, log });
        return result(dir, manifest, false, () => removeTree(dir));
    }

    const dir = join(root, key);
    // The "in use" mark goes first, so a neighbor's cleanup can't remove the build
    // between our check and the start of the workers.
    const inUseDir = join(root, ".in-use");
    mkdirSync(inUseDir, { recursive: true });
    const mark = join(inUseDir, `${key}@${String(process.pid)}`);
    writeFileSync(mark, "");
    const release = () => rmSync(mark, { force: true });

    let manifest = readManifest(dir);
    let hit = manifest !== null;
    if (manifest === null) {
        const unlock = acquireLock(join(root, `${key}.lock`), { log });
        try {
            manifest = readManifest(dir); // a neighbor may have built it while we waited for the lock
            hit = manifest !== null;
            if (manifest === null) {
                if (existsSync(dir)) removeTree(dir);
                const tmp = join(root, `${key}.tmp-${String(process.pid)}`);
                removeTree(tmp);
                log(`build ${key} is not in the cache (${root}), building`);
                const started = Date.now();
                manifest = buildInto(tmp, { repoRoot, version, log });
                freezeTree(tmp);
                renameWithRetry(tmp, dir);
                log(`built in ${String(Math.round((Date.now() - started) / 1000))} s → ${dir}`);
            }
        } finally {
            unlock();
        }
    }
    if (hit) log(`build ${key} from cache: ${dir}`);
    // "Last used" is the directory mtime (the owner may utimes a read-only one too).
    const now = new Date();
    try {
        utimesSync(dir, now, now);
    } catch {
        // someone else's cache: eviction just treats the build as old
    }
    const removed = evict(root, { keep: keep ?? Number(process.env.DIODE_E2E_CACHE_KEEP ?? DEFAULT_KEEP) });
    if (removed.length > 0) log(`evicted from cache: ${removed.length}`);
    return result(dir, manifest, hit, release);
}

function listCache(root) {
    let names = [];
    try {
        names = readdirSync(root).filter((n) => KEY_RE.test(n));
    } catch {
        // empty
    }
    for (const name of names) {
        const manifest = readManifest(join(root, name));
        const used = new Date(statSync(join(root, name)).mtimeMs).toISOString();
        console.log(`${name}  used ${used}  ${manifest === null ? "BROKEN" : `built ${manifest.builtAt} from ${manifest.builtFrom}`}`);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const repoRoot = resolve(import.meta.dirname, "..");
    const arg = process.argv[2];
    if (arg === "--key") console.log(computeBuildKey(repoRoot) ?? "(not a git tree)");
    else if (arg === "--list") listCache(cacheRoot());
    else {
        const built = ensureE2eArtifacts({ repoRoot });
        built.release();
        console.log(built.dir);
    }
}
