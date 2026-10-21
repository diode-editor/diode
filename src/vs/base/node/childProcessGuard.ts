import type { ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";

import { Emitter, type Event } from "../common/event.ts";
import { Disposable } from "../common/lifecycle.ts";

export interface IChildProcessEnd {
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
    readonly error?: unknown;
}

export interface IChildProcessLogger {
    warn(message: string): void;
}

export interface IChildProcessGuardOptions {
    readonly label: string;
    readonly logger?: IChildProcessLogger;
    readonly logStderr?: boolean;
    /**
     * Конец по `close`, а не `exit`: нужен разбирающим stdout (rg) — после `exit`
     * в потоках ещё есть данные. Не для самофорков: stdio наследуют внуки, и
     * `close` не придёт, пока жив последний.
     */
    readonly waitForStdio?: boolean;
}

/**
 * - `error` через `on`, не `once`: закрытый IPC-канал эмитит ошибку на каждый
 *   `send`, и вторая без слушателя роняет редактор;
 * - `error` без `exit` (неудачный спавн) — тоже конец процесса.
 */
export class GuardedChildProcess extends Disposable {
    private readonly onDidEndEmitter = this.register(new Emitter<IChildProcessEnd>());
    public readonly onDidEnd: Event<IChildProcessEnd> = this.onDidEndEmitter.event;
    private ended = false;

    public constructor(
        public readonly child: ChildProcess,
        private readonly options: IChildProcessGuardOptions,
    ) {
        super();
        child.on("error", (error: unknown) => {
            if (this.ended) this.options.logger?.warn(`[${options.label}] process error after end: ${String(error)}`);
            this.end({ code: null, signal: null, error });
        });
        child.once(options.waitForStdio === true ? "close" : "exit", (code: number | null, signal) => {
            this.end({ code, signal });
        });
        const streams = { stdin: child.stdin, stdout: child.stdout, stderr: child.stderr };
        for (const [name, stream] of Object.entries(streams)) {
            // Сломавшийся поток без слушателя убил бы редактор.
            stream?.on("error", (error: unknown) => {
                this.options.logger?.warn(`[${options.label}] ${name} stream error: ${String(error)}`);
            });
        }
        const { stderr } = child;
        if (options.logStderr === true && stderr !== null) {
            splitLines(stderr, (line) => {
                this.options.logger?.warn(`[${options.label}] ${line}`);
            });
        }
    }

    public override dispose(): void {
        this.child.kill("SIGKILL");
        super.dispose();
    }

    private end(end: IChildProcessEnd): void {
        if (this.ended) return;
        this.ended = true;
        this.onDidEndEmitter.fire(end);
    }
}

export function splitLines(stream: Readable, onLine: (line: string) => void): void {
    let buffer = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
        buffer += chunk;
        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
            onLine(buffer.slice(0, newline).replace(/\r$/, ""));
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf("\n");
        }
    });
    stream.on("end", () => {
        if (buffer !== "") onLine(buffer);
    });
}
