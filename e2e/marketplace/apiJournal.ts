import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { IApiTraceRecord } from "../../src/vs/workbench/api/common/apiTrace.ts";

/**
 * `<dir>/<id>.jsonl` exists only after a green check; `npm run api-matrix -- --update-confirmed`
 * reads it. The apps of a check inherit `DIODE_API_TRACE` from this process (`buildEnv`).
 */

export const API_JOURNAL_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)), "api-trace");

export interface IApiJournal {
    keep(): void;
    stop(): void;
}

/** vitest does not stop a timed-out check: its late `keep` and `stop` run during the next check. */
let current: object | undefined;

/** Call after the app's dispose: the journal flushes on a timer. Throws on a provider the entry says the extension lacks. */
export function expectNotRegistered(extensionId: string, absent: readonly string[]): void {
    const registered = readFileSync(process.env.DIODE_API_TRACE ?? "", "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as Pick<IApiTraceRecord, "extension" | "kind" | "member">)
        .filter((row) => row.extension === extensionId && row.kind === "registered")
        .map((row) => row.member);
    for (const member of absent) {
        if (registered.includes(member)) throw new Error(`${extensionId} now registers ${member}: update the entry`);
    }
}

export function startApiJournal(id: string, dir = API_JOURNAL_DIR): IApiJournal {
    mkdirSync(dir, { recursive: true });
    const kept = join(dir, `${id}.jsonl`);
    const pending = join(dir, `${id}.pending`);
    // A journal of an earlier green run must not outlive a red one.
    rmSync(kept, { force: true });
    rmSync(pending, { force: true });
    process.env.DIODE_API_TRACE = pending;
    const journal: IApiJournal = {
        keep: () => {
            // No host was started (nothing but a declarative extension): no journal, nothing to confirm.
            if (current === journal && existsSync(pending)) renameSync(pending, kept);
        },
        stop: () => {
            if (current === journal) {
                current = undefined;
                delete process.env.DIODE_API_TRACE;
            }
            rmSync(pending, { force: true });
        },
    };
    current = journal;
    return journal;
}
