import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describeKilled, killByEnv, type MarkedProcess } from "./processSweep.ts";

/**
 * A temp root per run: `afterEach` is never reached on SIGKILL, OOM or timeout — that is how
 * 34,121 `diode-*` directories piled up (11 GB), with orphan processes holding 3.3 GB.
 * A root is stale by owner liveness, not by age: a long mutation run must not be cleaned
 * up by a neighboring one.
 */

// Not "diode-tests-": that prefix belongs to `createTestEnvironment`, and cleanup must not touch its directories.
const ROOT_PREFIX = "diode-testrun-";
const OWNER_FILE = "owner.pid";
/** Inherited by all descendants — orphans are killed by it (processSweep.ts). */
export const RUN_MARKER_ENV = "DIODE_TEST_TMP";

export type KillMarked = (root: string) => MarkedProcess[];

const killMarkedByRoot: KillMarked = (root) => killByEnv(RUN_MARKER_ENV, root);

export function createRunTmpRoot(parent: string, ownerPid: number = process.pid): string {
    const root = fs.mkdtempSync(path.join(parent, ROOT_PREFIX));
    fs.writeFileSync(path.join(root, OWNER_FILE), String(ownerPid), "utf-8");
    return root;
}

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        // EPERM — the process exists but is foreign: treat it as alive, never remove foreign roots.
        return (err as NodeJS.ErrnoException | null)?.code === "EPERM";
    }
}

export function pruneStaleRoots(
    parent: string,
    isProcessAlive: (pid: number) => boolean = isAlive,
    killMarked: KillMarked = killMarkedByRoot,
): string[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(parent, { withFileTypes: true });
    } catch {
        return [];
    }

    const removed: string[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith(ROOT_PREFIX)) continue;
        const root = path.join(parent, entry.name);
        if (ownerAlive(root, isProcessAlive)) continue;
        // Orphans of a killed run may still be alive and writing to the root.
        const killed = killMarked(root);
        if (killed.length > 0) {
            console.info(
                `[tmpRoot] killed processes of interrupted run ${root}: ${String(killed.length)}\n${describeKilled(killed)}`,
            );
        }
        try {
            fs.rmSync(root, { recursive: true, force: true });
            removed.push(root);
        } catch {
            // A foreign root we can't remove — not our concern.
        }
    }
    return removed;
}

function ownerAlive(root: string, isProcessAlive: (pid: number) => boolean): boolean {
    let raw: string;
    try {
        raw = fs.readFileSync(path.join(root, OWNER_FILE), "utf-8");
    } catch {
        return false;
    }
    const pid = Number.parseInt(raw.trim(), 10);
    if (!Number.isInteger(pid) || pid <= 0) return false;
    return isProcessAlive(pid);
}

export function setup(): () => void {
    return setupRunTmpRoot(killMarkedByRoot);
}

/** Not a `setup` parameter: vitest calls globalSetup with an argument (the project). */
export function setupRunTmpRoot(killMarked: KillMarked): () => void {
    const parent = process.env.DIODE_TEST_TMP_PARENT ?? os.tmpdir();
    const stale = pruneStaleRoots(parent, isAlive, killMarked);
    if (stale.length > 0) {
        console.info(`[tmpRoot] pruned roots of interrupted runs: ${stale.length}`);
    }

    const root = createRunTmpRoot(parent);
    process.env[RUN_MARKER_ENV] = root;
    for (const name of TEMP_ENV_VARS) process.env[name] = root;

    return () => {
        const killed = killMarked(root);
        if (killed.length > 0) {
            console.warn(
                `[tmpRoot] killed processes that outlived the run: ${String(killed.length)}\n${describeKilled(killed)}`,
            );
        }
        fs.rmSync(root, { recursive: true, force: true });
    };
}

/** All three that `os.tmpdir()` reads (posix and Windows), otherwise directories escape cleanup. */
export const TEMP_ENV_VARS = ["TMPDIR", "TEMP", "TMP"] as const;

export default setup;
