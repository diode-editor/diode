// PTY half of the embedded terminal (node-pty); the emulator half, shared with extension ptys, is `XtermSurface`.

import { readlink } from "node:fs/promises";

import type { IPty } from "node-pty";

import { getSystemShell } from "../../../../base/node/shell.ts";
import type { ITerminalEnvironmentContributor } from "../common/extensionEnvironment.ts";
import type { ITerminalRelaunchOptions } from "../common/terminalSessionFactory.ts";

import { loadNodePty } from "./loadNodePty.ts";
import { XtermSurface } from "./xtermSurface.ts";

export type { CoreMouseEvent } from "./xtermSurface.ts";

export interface EmbeddedTerminalOptions {
    cols: number;
    rows: number;
    shell?: string;
    args?: string[];
    cwd?: string;
    /** Applied over the inherited environment; `null` unsets a variable. */
    env?: Record<string, string | null>;
    strictEnv?: boolean;
    message?: string;
    scrollback?: number;
}

/**
 * Layers: base (empty with `strictEnv`) → terminal `env` (`null` unsets) → extension `contribute` →
 * ours: the emulator's `TERM`, no `TMUX` (inside our own tmux host it breaks detection).
 */
export function buildEnv(
    base: Record<string, string>,
    overrides: Readonly<Record<string, string | null>> | undefined,
    contribute?: (env: Record<string, string | undefined>) => void,
): Record<string, string> {
    const env: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries({ ...base, ...overrides })) {
        if (value !== null) env[key] = value;
    }
    contribute?.(env);
    env.TERM = "xterm-256color";
    delete env.TMUX;
    return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

function currentEnv(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
        /* v8 ignore start -- process.env never yields an undefined value (deleting a key removes the entry entirely), so the else path is unreachable; the guard exists only to satisfy the `string | undefined` type of ProcessEnv */
        if (value !== undefined) out[key] = value;
        /* v8 ignore stop */
    }
    return out;
}

export class EmbeddedTerminalSession extends XtermSurface {
    public shell: string;
    private pty: IPty;
    private initialCwd = "";

    /** @param environment extension environment collections; not applied with `strictEnv`. */
    public constructor(
        options: EmbeddedTerminalOptions,
        private readonly environment?: ITerminalEnvironmentContributor,
    ) {
        super({ cols: options.cols, rows: options.rows, scrollback: options.scrollback });

        // `TerminalOptions.message` is `writeln` into the emulator (upstream `_writeInitialText`)
        // before the first shell output: xterm writes are queued in order.
        if (options.message !== undefined) this.feedOutput(`${options.message}\r\n`);

        this.shell = options.shell ?? getSystemShell();
        this.pty = this.spawn(this.shell, options);
    }

    public get pid(): number {
        return this.pty.pid;
    }

    /** Linux and other `/proc` systems see `cd` in the shell; elsewhere — the cwd the process started in. */
    public async getCwd(): Promise<string> {
        try {
            return await readlink(`/proc/${String(this.pty.pid)}/cwd`);
        } catch {
            return this.initialCwd;
        }
    }

    protected sendInput(data: string): void {
        this.pty.write(data);
    }

    protected onDidResize(cols: number, rows: number): void {
        this.pty.resize(cols, rows);
    }

    protected disposeProcess(): void {
        // kill can't find an already exited process — its failure is swallowed here.
        try {
            this.pty.kill();
        } catch {
            // the process may have already exited
        }
    }

    /** The previous PTY has already exited and its listeners have fired — nothing to unsubscribe. */
    protected relaunchProcess(options: ITerminalRelaunchOptions): void {
        this.shell = options.shell ?? getSystemShell();
        this.pty = this.spawn(this.shell, { ...options, cols: this.cols, rows: this.rows });
    }

    private spawn(shell: string, options: EmbeddedTerminalOptions): IPty {
        const cwd = options.cwd ?? process.cwd();
        this.initialCwd = cwd;
        const strict = options.strictEnv === true;
        const environment = strict ? undefined : this.environment;
        const env = buildEnv(
            strict ? {} : currentEnv(),
            options.env,
            environment === undefined
                ? undefined
                : (target) => {
                      environment.apply(target, cwd);
                  },
        );
        const { spawn } = loadNodePty();
        const pty = spawn(shell, options.args ?? [], {
            // Stryker disable next-line StringLiteral: equivalent: with an empty name node-pty uses TERM from buildEnv
            name: "xterm-256color",
            cols: options.cols,
            rows: options.rows,
            cwd,
            env,
        });
        pty.onData((data) => {
            this.feedOutput(data);
        });
        pty.onExit(({ exitCode }) => {
            this.markExited(exitCode);
        });
        return pty;
    }
}
