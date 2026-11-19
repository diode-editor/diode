// PTY half of the embedded terminal (node-pty); the emulator half, shared with extension ptys, is `XtermSurface`.

import { copyFileSync } from "node:fs";
import { readlink } from "node:fs/promises";

import type { IPty } from "node-pty";

import { sanitizeProcessEnvironment } from "../../../../base/common/processes.ts";
import { generateUuid } from "../../../../base/common/uuid.ts";
import { getSystemShell } from "../../../../base/node/shell.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import { NULL_LOGGER } from "../../../../platform/log/common/nullLogService.ts";
import { getShellIntegrationInjection } from "../../../../platform/terminal/node/terminalEnvironment.ts";
import { VSCODE_SHIM_VERSION } from "../../../api/common/vscodeShimVersion.ts";
import type { ITerminalEnvironmentContributor } from "../common/extensionEnvironment.ts";
import type { ITerminalRelaunchOptions } from "../common/terminalSessionFactory.ts";

import { loadNodePty } from "./loadNodePty.ts";
import { loadShellIntegrationScriptsDir } from "./shellIntegrationScripts.ts";
import { XtermSurface } from "./xtermSurface.ts";

export type { CoreMouseEvent } from "./xtermSurface.ts";

/**
 * Upstream `ShutdownConstants.DataFlushTimeout`: node-pty may report the exit before the last output is read, so
 * the exit waits until the output has been quiet this long.
 */
export const DATA_FLUSH_TIMEOUT_MS = 250;

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
    /** `terminal.integrated.shellIntegration.enabled`; absent — no injection. */
    shellIntegrationEnabled?: boolean;
    /** A task terminal: never injected (upstream `isFeatureTerminal`). */
    isFeatureTerminal?: boolean;
}

/**
 * Layers (upstream `createTerminalEnvironment`): the inherited environment without VS Code/Electron variables
 * (`undefined` with `strictEnv`) → terminal `env` (`null` unsets) → extension `contribute` → the keys of a VS Code
 * terminal process (`TERM_PROGRAM=vscode`…, not with `strictEnv`) → ours: the emulator's `TERM`, no `TMUX`
 * (inside our own tmux host it breaks detection).
 */
export function buildEnv(
    inherited: Record<string, string> | undefined,
    overrides: Readonly<Record<string, string | null>> | undefined,
    contribute?: (env: Record<string, string | undefined>) => void,
): Record<string, string> {
    const env: Record<string, string | undefined> = { ...inherited };
    sanitizeProcessEnvironment(env, "VSCODE_IPC_HOOK_CLI");
    for (const [key, value] of Object.entries(overrides ?? {})) {
        env[key] = value ?? undefined;
    }
    contribute?.(env);
    if (inherited !== undefined) {
        // Upstream `addTerminalEnvironmentKeys`; the version is the one extensions see as `vscode.version`.
        env.TERM_PROGRAM = "vscode";
        env.TERM_PROGRAM_VERSION = VSCODE_SHIM_VERSION;
        env.COLORTERM = "truecolor";
    }
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
    /** Upstream `_closeTimeout`: the process exited, its output may still be arriving. */
    private closeTimeout: ReturnType<typeof setTimeout> | undefined;
    /** The pty reported the exit: its fd is closed (a resize would throw EBADF), though the session waits for output. */
    // Stryker disable next-line BooleanLiteral: spawn() in the constructor resets it before any read.
    private ptyExited = false;
    // Stryker disable next-line StringLiteral: spawn() in the constructor overwrites it before any read.
    private initialCwd = "";
    /** Upstream `shellIntegrationNonce`: one per terminal, kept across relaunches; `633;E` carries it back. */
    private readonly shellIntegrationNonce = generateUuid();

    /**
     * @param environment extension environment collections; not applied with `strictEnv`.
     * @param logger why shell integration was not injected (upstream logs to the pty host).
     */
    public constructor(
        options: EmbeddedTerminalOptions,
        private readonly environment?: ITerminalEnvironmentContributor,
        private readonly logger: ILogger = NULL_LOGGER,
    ) {
        super({ cols: options.cols, rows: options.rows, scrollback: options.scrollback });

        // `TerminalOptions.message` is `writeln` into the emulator (upstream `_writeInitialText`)
        // before the first shell output: xterm writes are queued in order.
        if (options.message !== undefined) this.printMessage(`${options.message}\r\n`);

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
        if (!this.ptyExited) this.pty.write(data);
    }

    protected onDidResize(cols: number, rows: number): void {
        if (!this.ptyExited) this.pty.resize(cols, rows);
    }

    protected disposeProcess(): void {
        clearTimeout(this.closeTimeout);
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

    /** Upstream `_queueProcessExit`: every output chunk after the exit restarts the wait. */
    private queueProcessExit(exitCode: number): void {
        clearTimeout(this.closeTimeout);
        this.closeTimeout = setTimeout(() => {
            this.closeTimeout = undefined;
            this.markExited(exitCode);
        }, DATA_FLUSH_TIMEOUT_MS);
    }

    private spawn(shell: string, options: EmbeddedTerminalOptions): IPty {
        const cwd = options.cwd ?? process.cwd();
        this.initialCwd = cwd;
        const strict = options.strictEnv === true;
        const environment = strict ? undefined : this.environment;
        const env = buildEnv(
            strict ? undefined : currentEnv(),
            options.env,
            environment === undefined
                ? undefined
                : (target) => {
                      environment.apply(target, cwd);
                  },
        );
        const args = this.injectShellIntegration(shell, options, env);
        const { spawn } = loadNodePty();
        const pty = spawn(shell, args, {
            // Stryker disable next-line StringLiteral: equivalent: with an empty name node-pty uses TERM from buildEnv
            name: "xterm-256color",
            cols: options.cols,
            rows: options.rows,
            cwd,
            env,
        });
        let exitCode = 0;
        pty.onData((data) => {
            this.feedOutput(data);
            if (this.closeTimeout !== undefined) this.queueProcessExit(exitCode);
        });
        this.ptyExited = false;
        pty.onExit((event) => {
            this.ptyExited = true;
            exitCode = event.exitCode;
            this.queueProcessExit(exitCode);
        });
        return pty;
    }

    /**
     * Upstream `TerminalProcess.start`: the injection's environment and files, else the shell's own arguments. The
     * nonce is set either way — an extension's own shell integration can use it.
     */
    private injectShellIntegration(
        shell: string,
        options: EmbeddedTerminalOptions,
        env: Record<string, string>,
    ): string[] {
        env.VSCODE_NONCE = this.shellIntegrationNonce;
        const injection = getShellIntegrationInjection(
            { executable: shell, args: options.args, isFeatureTerminal: options.isFeatureTerminal },
            { enabled: options.shellIntegrationEnabled === true, scriptsDir: loadShellIntegrationScriptsDir },
            env,
            this.logger,
        );
        if (injection.type === "failure") return options.args ?? [];
        Object.assign(env, injection.envMixin);
        for (const file of injection.filesToCopy ?? []) {
            try {
                copyFileSync(file.source, file.dest);
            } catch {
                // Upstream: only another user's copy of the same scripts is in the way — keep it.
            }
        }
        return [...injection.newArgs];
    }
}
