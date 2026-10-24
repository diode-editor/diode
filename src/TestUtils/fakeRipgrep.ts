import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

/**
 * A shell script in place of `rg`: prints canned lines and, with `hang`, then sleeps like rg stuck in
 * `getdents` on a cold FUSE mount. Each run records its pid, cwd and args, so a test sees who started it and
 * whether it was killed. POSIX only (`#!/bin/sh`).
 */
export interface IFakeRipgrep {
    readonly path: string;
    /** One per run, in start order. */
    pids(): number[];
    /** The pid of the single run so far; throws otherwise. */
    onlyPid(): number;
    lastCwd(): string;
    lastArgs(): string[];
    dispose(): void;
}

export interface IFakeRipgrepOptions {
    readonly stdoutLines?: readonly string[];
    readonly hang?: boolean;
    readonly code?: number;
    /** Written to stderr BEFORE stdout: more than a pipe holds blocks a reader that never drains it. */
    readonly stderrBytes?: number;
}

export function writeFakeRipgrep(options: IFakeRipgrepOptions = {}): IFakeRipgrep {
    const dir = mkdtempSync(path.join(tmpdir(), "diode-fake-rg-"));
    const file = (name: string): string => path.join(dir, name);
    writeFileSync(file("stdout"), (options.stdoutLines ?? []).map((line) => `${line}\n`).join(""));
    const script = file("rg");
    writeFileSync(
        script,
        [
            "#!/bin/sh",
            `echo $$ >> '${file("pids")}'`,
            `pwd > '${file("cwd")}'`,
            `printf '%s\\n' "$@" > '${file("args")}'`,
            ...(options.stderrBytes !== undefined ? [`head -c ${String(options.stderrBytes)} /dev/zero >&2`] : []),
            `cat '${file("stdout")}'`,
            // `exec`: the pid on record IS the sleeping process, so "killed" means the search is gone.
            ...(options.hang === true ? ["exec sleep 60"] : []),
            `exit ${String(options.code ?? 0)}`,
            "",
        ].join("\n"),
    );
    chmodSync(script, 0o755);
    const read = (name: string): string => (existsSync(file(name)) ? readFileSync(file(name), "utf8") : "");
    const pids = (): number[] =>
        read("pids")
            .split("\n")
            .filter((line) => line !== "")
            .map(Number);
    return {
        path: script,
        pids,
        onlyPid: () => {
            const all = pids();
            if (all.length !== 1) throw new Error(`expected one fake rg run, got [${all.join(", ")}]`);
            return all[0];
        },
        lastCwd: () => read("cwd").trimEnd(),
        lastArgs: () => read("args").split("\n").slice(0, -1),
        dispose: () => {
            rmSync(dir, { recursive: true, force: true });
        },
    };
}

/** Signal 0 checks existence only. Node reaps its children, so a killed one stops answering. */
export function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}
