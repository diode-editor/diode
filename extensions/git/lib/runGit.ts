import { spawn } from "node:child_process";

export interface IRunGitOptions {
    cwd?: string;
    /** SIGKILL after it. */
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
}

export interface IRunGitResult {
    /** `-1` when the child was killed (timeout/signal). */
    code: number;
    stdout: string;
    stderr: string;
}

/** The `git` binary was missing or could not be started. */
export interface IRunGitError {
    error: Error;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Keyed by `(cwd, args)` only — env is not part of the key. */
const inFlight = new Map<string, Promise<IRunGitResult | IRunGitError>>();

/** Never rejects: a non-zero exit resolves like a success, callers branch on `code`. */
export function runGit(args: string[], opts: IRunGitOptions = {}): Promise<IRunGitResult | IRunGitError> {
    const key = JSON.stringify([opts.cwd ?? "", args]);
    const existing = inFlight.get(key);
    if (existing) return existing;

    const promise = spawnGit(args, opts).finally(() => {
        inFlight.delete(key);
    });
    inFlight.set(key, promise);
    return promise;
}

function spawnGit(args: string[], opts: IRunGitOptions): Promise<IRunGitResult | IRunGitError> {
    return new Promise((resolve) => {
        const child = spawn("git", args, { cwd: opts.cwd, env: opts.env });

        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let settled = false;

        const timer = setTimeout(() => {
            child.kill("SIGKILL");
        }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

        const finish = (value: IRunGitResult | IRunGitError): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
        };

        child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
        child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

        child.on("error", (error) => {
            finish({ error });
        });
        child.on("close", (code) => {
            finish({
                code: code ?? -1,
                stdout: Buffer.concat(stdout).toString("utf8"),
                stderr: Buffer.concat(stderr).toString("utf8"),
            });
        });
    });
}
