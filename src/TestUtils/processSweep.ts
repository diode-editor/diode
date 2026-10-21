import * as fs from "node:fs";
import * as path from "node:path";

/**
 * A marker in the environment, not the process tree: language servers live in their own group
 * (the extension subprocess is `detached`), so a group signal doesn't reach them, and after a
 * worker is killed the tree is broken — grandchildren are reparented to init. The environment,
 * however, is inherited down the whole chain. Linux only (`/proc/<pid>/environ`).
 */

export interface MarkedProcess {
    readonly pid: number;
    readonly command: string;
}

export interface ProcessTable {
    pids(): number[];
    /** Process environment as `NAME=value`; `null` — the process is gone or foreign. */
    environ(pid: number): string[] | null;
    command(pid: number): string;
    /** `null` — the process is gone. */
    parent(pid: number): number | null;
}

const PROC = "/proc";

export function createProcTable(platform: NodeJS.Platform = process.platform): ProcessTable | null {
    if (platform !== "linux") return null;
    return {
        pids: () =>
            fs
                .readdirSync(PROC)
                .filter((name) => /^\d+$/.test(name))
                .map(Number),
        environ: (pid) => readNulSeparated(path.join(PROC, String(pid), "environ")),
        command: (pid) => (readNulSeparated(path.join(PROC, String(pid), "cmdline")) ?? []).join(" "),
        parent: (pid) => {
            try {
                return parseParentPid(fs.readFileSync(path.join(PROC, String(pid), "stat"), "utf-8"));
            } catch {
                return null;
            }
        },
    };
}

export const procTable: ProcessTable | null = createProcTable();

function readNulSeparated(file: string): string[] | null {
    try {
        return fs
            .readFileSync(file, "utf-8")
            .split("\0")
            .filter((s) => s.length > 0);
    } catch {
        return null;
    }
}

/** `pid (comm) state ppid …`: comm may contain spaces and parentheses — fields follow the LAST `)`. */
export function parseParentPid(stat: string): number | null {
    const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
    return Number.isInteger(ppid) ? ppid : null;
}

/**
 * Excludes the current process and its direct children: those are vitest workers that exit on their own
 * in teardown, or an editor already killed by a group signal. Deeper descendants and orphans need killing.
 */
export function findByEnv(name: string, value: string, table: ProcessTable | null = procTable): MarkedProcess[] {
    if (table === null) return [];
    const needle = `${name}=${value}`;
    const found: MarkedProcess[] = [];
    for (const pid of table.pids()) {
        if (pid === process.pid) continue;
        if (table.environ(pid)?.includes(needle) !== true) continue;
        if (table.parent(pid) === process.pid) continue;
        found.push({ pid, command: table.command(pid) });
    }
    return found;
}

export interface KillOptions {
    table?: ProcessTable | null;
    kill?: (pid: number, signal: NodeJS.Signals) => void;
}

export function killByEnv(name: string, value: string, options: KillOptions = {}): MarkedProcess[] {
    const { table = procTable, kill = (pid, signal) => process.kill(pid, signal) } = options;
    const killed: MarkedProcess[] = [];
    for (const proc of findByEnv(name, value, table)) {
        try {
            kill(proc.pid, "SIGKILL");
            killed.push(proc);
        } catch {
            // exited on its own or foreign — not our concern
        }
    }
    return killed;
}

export interface ReapOptions extends KillOptions {
    graceMs?: number;
    pollMs?: number;
}

/** A non-empty result is a leak worth reporting loudly. */
export async function reapByEnv(name: string, value: string, options: ReapOptions = {}): Promise<MarkedProcess[]> {
    const { graceMs = 2000, pollMs = 100, table = procTable } = options;
    const deadline = Date.now() + graceMs;
    while (findByEnv(name, value, table).length > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    return killByEnv(name, value, options);
}

export function describeKilled(killed: readonly MarkedProcess[]): string {
    return killed.map((p) => `  ${String(p.pid)} ${p.command.slice(0, 200)}`).join("\n");
}
