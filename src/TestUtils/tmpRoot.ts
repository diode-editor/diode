import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describeKilled, killByEnv, type MarkedProcess } from "./processSweep.ts";

/**
 * Корень temp на прогон: `afterEach` не доходит при SIGKILL, OOM и таймауте — так
 * накопилось 34 121 каталога `diode-*` на 11 ГБ, а сироты-процессы держали 3,3 ГБ.
 * Корень бесхозный по живости владельца, а не по возрасту: долгий мутационный
 * прогон не должен попасть под уборку соседнего.
 */

// Не "diode-tests-": этот префикс у `createTestEnvironment`, его каталоги подчистка задевать не должна.
const ROOT_PREFIX = "diode-testrun-";
const OWNER_FILE = "owner.pid";
/** Наследуется всеми потомками — по нему добиваются сироты (processSweep.ts). */
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
        // EPERM — процесс есть, но чужой: считаем живым, чужое не сносим.
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
        // Сироты убитого прогона ещё могут жить и писать в корень.
        const killed = killMarked(root);
        if (killed.length > 0) {
            console.info(
                `[tmpRoot] добито процессов прерванного прогона ${root}: ${String(killed.length)}\n${describeKilled(killed)}`,
            );
        }
        try {
            fs.rmSync(root, { recursive: true, force: true });
            removed.push(root);
        } catch {
            // Чужой корень без прав на снос — не наша забота.
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

/** Не параметр `setup`: vitest зовёт globalSetup с аргументом (проект). */
export function setupRunTmpRoot(killMarked: KillMarked): () => void {
    const parent = process.env.DIODE_TEST_TMP_PARENT ?? os.tmpdir();
    const stale = pruneStaleRoots(parent, isAlive, killMarked);
    if (stale.length > 0) {
        console.info(`[tmpRoot] подчищено корней от прерванных прогонов: ${stale.length}`);
    }

    const root = createRunTmpRoot(parent);
    process.env[RUN_MARKER_ENV] = root;
    for (const name of TEMP_ENV_VARS) process.env[name] = root;

    return () => {
        const killed = killMarked(root);
        if (killed.length > 0) {
            console.warn(
                `[tmpRoot] добито процессов, переживших прогон: ${String(killed.length)}\n${describeKilled(killed)}`,
            );
        }
        fs.rmSync(root, { recursive: true, force: true });
    };
}

/** Все три, которые читает `os.tmpdir()` (posix и Windows), иначе каталоги уходят мимо уборки. */
export const TEMP_ENV_VARS = ["TMPDIR", "TEMP", "TMP"] as const;

export default setup;
