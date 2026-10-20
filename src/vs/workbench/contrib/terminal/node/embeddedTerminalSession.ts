// Связка node-pty ↔ @xterm/headless — «сервер» встроенного терминала.
//
// Держит реальную PTY-пару (node-pty: ядро выдаёт настоящий TTY → интерактивность)
// и VT-эмулятор (@xterm/headless: парсит вывод шелла в сетку ячеек, читаемую через
// `terminal.buffer.active`). Наружу торчит контракт `ITerminalSurface`: прочитать
// ячейку (`readCell`), позицию курсора (`getCursor`), подать ввод (`write`), мышь
// (`sendMouse`), сменить размер (`resize`), подписаться на «есть новые данные»
// (`onUpdate`) и на выход шелла (`onExit`). Эмуляторная половина общая с pty
// расширений — `XtermSurface`; здесь только PTY.
//
// Это Workbench-слой (выше TUIDom), поэтому импорт node-pty здесь допустим: слои
// TUIDom и ниже остаются чистыми, а виджет `TerminalViewElement` видит только
// `ITerminalSurface`. См. docs/arch/workbench/Terminal.md.

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
    /** Окружение — ровно `env`, без унаследованного от процесса. */
    strictEnv?: boolean;
    /** Строка в эмулятор до вывода шелла (с переводом строки); в шелл не уходит. */
    message?: string;
    scrollback?: number;
}

/**
 * Окружение шелла: база (унаследованное или пустое при `strictEnv`), поверх —
 * `env` терминала (`null` снимает переменную, как `TerminalOptions.env`), затем
 * довесок `contribute` (коллекции окружения расширений) и наше обязательное:
 * `TERM` эмулятора, без `TMUX` (внутри собственного tmux-хоста он сбивает детект).
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

/** Отфильтровать `undefined`-значения из process.env (node-pty ждёт `Record<string,string>`). */
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
    /** Запущенный шелл — по нему вкладка терминала получает заголовок. */
    public shell: string;
    private pty: IPty;

    /**
     * @param environment довесок к окружению каждого запуска процесса —
     *   коллекции расширений (не при `strictEnv`)
     */
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

    /** Pid процесса шелла. */
    public get pid(): number {
        return this.pty.pid;
    }

    protected sendInput(data: string): void {
        this.pty.write(data);
    }

    /** Синхронный ресайз PTY (TIOCSWINSZ+SIGWINCH). */
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

    /**
     * Новый PTY с текущим размером эмулятора. Прежний уже вышел: его `onExit`
     * отстрелял, и подписки на него больше не сработают — снимать нечего.
     */
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
        // Вывод шелла → эмулятор → сигнал перерисовки контролу (см. feedOutput).
        pty.onData((data) => {
            this.feedOutput(data);
        });
        pty.onExit(({ exitCode }) => {
            this.markExited(exitCode);
        });
        return pty;
    }
}
