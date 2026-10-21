import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Метка в окружении, а не дерево процессов: языковые серверы живут в своей группе
 * (субпроцесс расширений `detached`), групповой сигнал до них не доходит, а после
 * убитого воркера дерево разорвано — внуки у init. Окружение же наследуется по всей
 * цепочке. Только Linux (`/proc/<pid>/environ`).
 */

export interface MarkedProcess {
    readonly pid: number;
    readonly command: string;
}

export interface ProcessTable {
    pids(): number[];
    /** Окружение процесса как `NAME=value`; `null` — процесс исчез или чужой. */
    environ(pid: number): string[] | null;
    command(pid: number): string;
    /** `null` — процесс исчез. */
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

/** `pid (comm) state ppid …`: comm может содержать пробелы и скобки — поля после ПОСЛЕДНЕЙ `)`. */
export function parseParentPid(stat: string): number | null {
    const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
    return Number.isInteger(ppid) ? ppid : null;
}

/**
 * Кроме текущего и его прямых детей: это воркеры vitest, доживающие в teardown сами,
 * или редактор, уже убитый групповым сигналом. Добивать нужно глубже и сирот.
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
            // успел выйти сам или чужой — не наша забота
        }
    }
    return killed;
}

export interface ReapOptions extends KillOptions {
    graceMs?: number;
    pollMs?: number;
}

/** Непустой результат — утечка, о ней стоит сказать вслух. */
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
