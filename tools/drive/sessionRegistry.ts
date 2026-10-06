import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Реестр сессий `npm run drive`: по файлу `<name>.json` на живую сессию.
 * Каталог — `.drive/sessions/` в корне checkout'а (gitignored), то есть у
 * каждого worktree свой реестр: параллельные агенты в соседних worktree не
 * видят и не гасят сессии друг друга, хотя у всех сессия по умолчанию
 * называется `default`.
 */
export interface SessionRecord {
    readonly name: string;
    /** Pid запущенного процесса — лидер своей группы (`detached`). */
    readonly pid: number;
    /**
     * Pid текущего окна. После `reloadWindow` лидер остаётся супервизором, а окно —
     * новый процесс на том же порту; `wait reload` ждёт окно с другим pid.
     */
    readonly windowPid: number;
    readonly port: number;
    /** Временный корень сессии: user-data-dir, home, workspace, логи. */
    readonly root: string;
    readonly workspaceDir: string;
    readonly userDataDir: string;
    /** `source` — `node --import tsx src/vs/diode/main.ts`, `binary` — собранный бинарь. */
    readonly mode: "source" | "binary";
    /** Что именно запущено: путь бинаря или `main.ts`. */
    readonly entry: string;
    readonly cols: number;
    readonly rows: number;
    readonly startedAt: string;
    readonly stdoutFile: string;
    readonly stderrFile: string;
    /** Не удалять корень при `stop` (пост-мортем). */
    readonly keep: boolean;
    /** Значение маркера в env процессов сессии — по нему `stop`/`gc` находят сирот. */
    readonly marker: string;
}

/** Имя переменной-маркера: наследуется всеми потомками, переживает `setsid`. */
export const SESSION_MARKER_ENV = "DIODE_DRIVE_SESSION";

/** Префикс временного корня — `gc` узнаёт по нему брошенные корни. */
export const ROOT_PREFIX = "diode-drive-";

const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

export function validateSessionName(name: string): string {
    if (!NAME_RE.test(name)) throw new Error(`недопустимое имя сессии: ${JSON.stringify(name)} (буквы, цифры, . _ -)`);
    return name;
}

export class SessionRegistry {
    public constructor(private readonly dir: string) {}

    private file(name: string): string {
        return join(this.dir, `${validateSessionName(name)}.json`);
    }

    public read(name: string): SessionRecord | undefined {
        const file = this.file(name);
        try {
            return JSON.parse(readFileSync(file, "utf8")) as SessionRecord;
        } catch {
            return undefined;
        }
    }

    public write(record: SessionRecord): void {
        mkdirSync(this.dir, { recursive: true });
        writeFileSync(this.file(record.name), `${JSON.stringify(record, null, 2)}\n`);
    }

    public remove(name: string): void {
        rmSync(this.file(name), { force: true });
    }

    public list(): SessionRecord[] {
        let names: string[];
        try {
            names = readdirSync(this.dir);
        } catch {
            return [];
        }
        const records: SessionRecord[] = [];
        for (const entry of names.sort()) {
            if (!entry.endsWith(".json")) continue;
            const record = this.read(entry.slice(0, -".json".length));
            if (record !== undefined) records.push(record);
        }
        return records;
    }
}
