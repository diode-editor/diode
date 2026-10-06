import { readdirSync, readFileSync } from "node:fs";

import { SESSION_MARKER_ENV } from "./sessionRegistry.ts";

/**
 * Жив ли процесс (сигнал 0 — проверка без доставки; EPERM — жив, но чужой).
 * Зомби — мёртв: лидер сессии, убитый `kill -9`, переподвешивается к init, а
 * init контейнера не всегда пожинает детей — `kill(pid, 0)` такому отвечает
 * «есть», хотя сессии уже нет.
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
        // `pid (comm) S …` — comm может содержать пробелы и скобки, состояние — после последней `)`.
        return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) === "Z";
    } catch {
        return false; // не Linux или уже пожат
    }
}

export interface MarkedProcess {
    readonly pid: number;
    readonly marker: string;
}

/**
 * Процессы с маркером сессии в env (Linux, `/proc/<pid>/environ`). Маркер
 * наследуют все потомки редактора — субпроцесс расширений, языковые серверы,
 * watcher, — в том числе ушедшие в свою группу (`setsid`), до которых
 * `kill(-pgid)` не дотягивается. На других ОС список пуст: там уборка держится
 * только на группе процессов.
 */
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
            continue; // чужой процесс или уже вышел
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
        // уже вышел
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Гасит всё, что принадлежит сессии: группу лидера `pid` и все процессы с её
 * маркером. Сначала SIGTERM (дать extension host'у и серверам уйти самим),
 * через `graceMs` — SIGKILL всем, кто остался. Возвращает, сколько процессов
 * пришлось добивать SIGKILL.
 */
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
    // SIGKILL доставляется асинхронно — подождём, пока /proc это отразит.
    const killDeadline = Date.now() + 2000;
    while (targets().length > 0 && Date.now() < killDeadline) await sleep(50);
    return left.length;
}
