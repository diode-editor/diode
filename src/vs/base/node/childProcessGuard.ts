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
     * Ends on `close`, not `exit`: needed by stdout parsers (rg), after `exit`
     * the streams still hold data. Not for self-forks: grandchildren inherit stdio, and
     * `close` won't come while the last one is alive.
     */
    readonly waitForStdio?: boolean;
}

/**
 * - `error` via `on`, not `once`: a closed IPC channel emits an error on every
 *   `send`, and the second one without a listener crashes the editor;
 * - `error` without `exit` (failed spawn) also ends the process.
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
            // A broken stream without a listener would kill the editor.
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
