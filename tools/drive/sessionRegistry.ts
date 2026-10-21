import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The registry lives in the checkout root, so each worktree has its own: parallel agents
 * do not kill each other's sessions, even though everyone's default session is `default`.
 */
export interface SessionRecord {
    readonly name: string;
    /** Leader of its own process group (`detached`). */
    readonly pid: number;
    /** After `reloadWindow` the window is a new process on the same port; the leader stays the supervisor. */
    readonly windowPid: number;
    readonly port: number;
    readonly root: string;
    readonly workspaceDir: string;
    readonly userDataDir: string;
    readonly mode: "source" | "binary";
    readonly entry: string;
    readonly cols: number;
    readonly rows: number;
    readonly startedAt: string;
    readonly stdoutFile: string;
    readonly stderrFile: string;
    /** Keep the root on `stop` (post-mortem). */
    readonly keep: boolean;
    readonly marker: string;
}

/** Inherited by all descendants and survives `setsid`; `stop`/`gc` find orphans by it. */
export const SESSION_MARKER_ENV = "DIODE_DRIVE_SESSION";

export const ROOT_PREFIX = "diode-drive-";

const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

export function validateSessionName(name: string): string {
    if (!NAME_RE.test(name)) throw new Error(`invalid session name: ${JSON.stringify(name)} (letters, digits, . _ -)`);
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
