// PTY-половина встроенного терминала (node-pty); эмуляторная, общая с pty расширений, — `XtermSurface`.

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
    /** Поверх унаследованного окружения; `null` снимает переменную. */
    env?: Record<string, string | null>;
    strictEnv?: boolean;
    message?: string;
    scrollback?: number;
}

/**
 * Слои: база (пустая при `strictEnv`) → `env` терминала (`null` снимает) → `contribute` расширений →
 * наше: `TERM` эмулятора, без `TMUX` (внутри собственного tmux-хоста он сбивает детект).
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

    /** @param environment коллекции окружения расширений; при `strictEnv` не применяются. */
    public constructor(
        options: EmbeddedTerminalOptions,
        private readonly environment?: ITerminalEnvironmentContributor,
    ) {
        super({ cols: options.cols, rows: options.rows, scrollback: options.scrollback });

        // `TerminalOptions.message` — `writeln` в эмулятор (`_writeInitialText`
        // эталона) до первого вывода шелла: записи xterm идут по очереди.
        if (options.message !== undefined) this.feedOutput(`${options.message}\r\n`);

        this.shell = options.shell ?? getSystemShell();
        this.pty = this.spawn(this.shell, options);
    }

    public get pid(): number {
        return this.pty.pid;
    }

    protected sendInput(data: string): void {
        this.pty.write(data);
    }

    protected onDidResize(cols: number, rows: number): void {
        this.pty.resize(cols, rows);
    }

    protected disposeProcess(): void {
        // Уже вышедший процесс kill не найдёт — его отказ глотается здесь же.
        try {
            this.pty.kill();
        } catch {
            // процесс мог уже завершиться
        }
    }

    /** Прежний PTY уже вышел и его подписки отстреляли — снимать нечего. */
    protected relaunchProcess(options: ITerminalRelaunchOptions): void {
        this.shell = options.shell ?? getSystemShell();
        this.pty = this.spawn(this.shell, { ...options, cols: this.cols, rows: this.rows });
    }

    private spawn(shell: string, options: EmbeddedTerminalOptions): IPty {
        const cwd = options.cwd ?? process.cwd();
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
            // Stryker disable next-line StringLiteral: эквивалентный — TERM уже задан в env (buildEnv), node-pty берёт его при пустом name
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
