import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Поиск и добивание процессов по метке в окружении.
 *
 * Зачем метка, а не дерево процессов. Языковые серверы живут в СВОЕЙ группе
 * процессов (субпроцесс расширений стартует `detached`, см.
 * `extensionHostProcess.ts`), и групповой сигнал редактору до них не доходит;
 * а когда воркер теста убит по таймауту или OOM, их родители уже мертвы и
 * дерево разорвано — внуки переподвешены к init. Окружение же наследуется по
 * всей цепочке, как бы она ни рвалась: метка, выставленная при спавне, есть у
 * каждого потомка. Её и ищем.
 *
 * Только Linux (`/proc/<pid>/environ`). На других ОС поиск ничего не находит —
 * там остаются групповой сигнал и уборка каталогов.
 */

/** Процесс, найденный по метке. */
export interface MarkedProcess {
    readonly pid: number;
    /** Командная строка — для сообщения о том, кого добили. */
    readonly command: string;
}

/** Доступ к таблице процессов; в тестах подменяется. */
export interface ProcessTable {
    pids(): number[];
    /** Окружение процесса как `NAME=value`; `null` — процесс исчез или чужой. */
    environ(pid: number): string[] | null;
    command(pid: number): string;
    /** Pid родителя; `null` — процесс исчез. */
    parent(pid: number): number | null;
}

const PROC = "/proc";

/** Таблица процессов Linux; на других ОС — `null` (искать негде). */
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
                return null; // процесс ушёл
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
        // ESRCH/ENOENT — процесс ушёл, EACCES — чужой: в обоих случаях не наш
        return null;
    }
}

/**
 * `ppid` из строки `/proc/<pid>/stat`: `pid (comm) state ppid …`. Имя команды
 * может содержать пробелы и скобки, поэтому поля считаем после ПОСЛЕДНЕЙ `)`.
 */
export function parseParentPid(stat: string): number | null {
    const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
    return Number.isInteger(ppid) ? ppid : null;
}

/**
 * Все процессы с ровно `name=value` в окружении — кроме текущего и его прямых
 * детей. Прямые дети — это воркеры пула vitest (в teardown они ещё могут
 * доживать, уходя сами) или, в воркере, сам редактор, которого к этому моменту
 * уже убил групповой сигнал. Добивать нужно потомков глубже — и сирот, чьих
 * родителей уже нет.
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

/** SIGKILL всем процессам с меткой. Возвращает тех, кому сигнал ушёл. */
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
    /** Сколько дать процессам выйти самим, прежде чем добивать. */
    graceMs?: number;
    pollMs?: number;
}

/**
 * Дождаться, пока процессы с меткой выйдут сами (корректное прощание — например,
 * расширение гасит свой языковой сервер по `deactivate`), и добить оставшихся.
 * Возвращает добитых: непустой список — это утечка, о ней стоит сказать вслух.
 */
export async function reapByEnv(name: string, value: string, options: ReapOptions = {}): Promise<MarkedProcess[]> {
    const { graceMs = 2000, pollMs = 100, table = procTable } = options;
    const deadline = Date.now() + graceMs;
    while (findByEnv(name, value, table).length > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    return killByEnv(name, value, options);
}

/** Строка для лога: кого добили. */
export function describeKilled(killed: readonly MarkedProcess[]): string {
    return killed.map((p) => `  ${String(p.pid)} ${p.command.slice(0, 200)}`).join("\n");
}
