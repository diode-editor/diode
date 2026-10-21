import { readdirSync, readFileSync } from "node:fs";

import { SESSION_MARKER_ENV } from "./sessionRegistry.ts";

/**
 * A zombie counts as dead: a killed leader is reparented to init, the container's init does not always
 * reap children, and `kill(pid, 0)` reports it as present although the session is gone.
 */
export function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
    } catch (err) {
        return (err as NodeJS.ErrnoException).code === "EPERM";
    }
    return !isZombie(pid);
}

function isZombie(pid: number): boolean {
    try {
        const stat = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
        // comm may contain spaces and parentheses, so the state follows the last `)`.
        return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) === "Z";
    } catch {
        return false; // not Linux or already reaped
    }
}

export interface MarkedProcess {
    readonly pid: number;
    readonly marker: string;
}

/** The marker also finds processes that left for their own group (`setsid`), out of reach of `kill(-pgid)`. */
export function findMarkedProcesses(): MarkedProcess[] {
    if (process.platform !== "linux") return [];
    const prefix = `${SESSION_MARKER_ENV}=`;
    const found: MarkedProcess[] = [];
    let entries: string[];
    try {
        entries = readdirSync("/proc");
    } catch {
        return [];
    }
    for (const entry of entries) {
        if (!/^\d+$/.test(entry)) continue;
        const pid = Number(entry);
        if (pid === process.pid) continue;
        let environ: string;
        try {
            environ = readFileSync(`/proc/${entry}/environ`, "latin1");
        } catch {
            continue; // foreign process or already exited
        }
        for (const variable of environ.split("\0")) {
            if (variable.startsWith(prefix)) {
                found.push({ pid, marker: Buffer.from(variable.slice(prefix.length), "latin1").toString("utf8") });
                break;
            }
        }
    }
    return found;
}

function signal(pid: number, sig: NodeJS.Signals): void {
    try {
        process.kill(pid, sig);
    } catch {
        // already exited
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Returns how many processes had to be finished off with SIGKILL. */
export async function killSessionProcesses(pid: number | undefined, marker: string, graceMs = 3000): Promise<number> {
    const targets = (): number[] => {
        const pids = findMarkedProcesses()
            .filter((p) => p.marker === marker)
            .map((p) => p.pid);
        if (pid !== undefined && isAlive(pid)) pids.push(pid);
        return [...new Set(pids)];
    };
    if (pid !== undefined) signal(-pid, "SIGTERM");
    for (const p of targets()) signal(p, "SIGTERM");
    const deadline = Date.now() + graceMs;
    while (targets().length > 0 && Date.now() < deadline) await sleep(100);
    const left = targets();
    if (pid !== undefined) signal(-pid, "SIGKILL");
    for (const p of left) signal(p, "SIGKILL");
    // SIGKILL is delivered asynchronously; wait until /proc reflects it.
    const killDeadline = Date.now() + 2000;
    while (targets().length > 0 && Date.now() < killDeadline) await sleep(50);
    return left.length;
}
