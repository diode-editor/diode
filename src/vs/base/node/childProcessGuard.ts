import type { ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";

import { Emitter, type Event } from "../common/event.ts";
import { Disposable } from "../common/lifecycle.ts";

/** Чем закончился процесс: `error` есть, если он не поднялся или сломался без `exit`. */
export interface IChildProcessEnd {
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
    readonly error?: unknown;
}

/** Куда guard пишет — узкая форма `ILogger` (base не зависит от platform). */
export interface IChildProcessLogger {
    warn(message: string): void;
}

export interface IChildProcessGuardOptions {
    /** Имя процесса в логе: `[label] …`. */
    readonly label: string;
    readonly logger?: IChildProcessLogger;
    /** stderr ребёнка — построчно в `logger.warn` (иначе поток не читается вовсе). */
    readonly logStderr?: boolean;
    /**
     * Конец — по `close` (вывод дочитан до конца), а не по `exit`. Нужен тому, кто
     * разбирает stdout (rg): после `exit` в потоках ещё могут оставаться данные.
     * Самофоркам — нет: stdio могут унаследовать внуки (language-серверы), и
     * `close` не придёт, пока жив последний из них.
     */
    readonly waitForStdio?: boolean;
}

/**
 * Принадлежащий нам дочерний процесс под правилами `docs/ARCHITECTURE.md`
 * («Роли процессов») — они исполняются здесь, а не держатся комментариями у
 * каждого владельца:
 *
 *  - `error` слушается через `on`, не `once`: закрытый IPC-канал эмитит ошибку
 *    на каждый `send`, и вторая такая без слушателя — исключение, то есть
 *    смерть редактора;
 *  - `error` без `exit` (неудачный спавн: `EMFILE`, `ENOENT`) — тоже конец
 *    процесса: состояние владельца не ведётся по одному `exit`;
 *  - у каждого stdio-потока есть слушатель `error`;
 *  - {@link onDidEnd} приходит ровно один раз; политику (рестарт, сброс
 *    состояния) решает владелец в своём слушателе.
 */
export class GuardedChildProcess extends Disposable {
    private readonly onDidEndEmitter = this.register(new Emitter<IChildProcessEnd>());
    /** Конец процесса — ровно один раз: `exit` (или `close`) ЛИБО `error` без них. */
    public readonly onDidEnd: Event<IChildProcessEnd> = this.onDidEndEmitter.event;
    private ended = false;

    public constructor(
        public readonly child: ChildProcess,
        private readonly options: IChildProcessGuardOptions,
    ) {
        super();
        child.on("error", (error: unknown) => {
            // Первую ошибку получает владелец (и сам решает, писать ли её); те,
            // что пришли после конца, ему уже не нужны — только в лог.
            if (this.ended) this.options.logger?.warn(`[${options.label}] process error after end: ${String(error)}`);
            this.end({ code: null, signal: null, error });
        });
        child.once(options.waitForStdio === true ? "close" : "exit", (code: number | null, signal) => {
            this.end({ code, signal });
        });
        const streams = { stdin: child.stdin, stdout: child.stdout, stderr: child.stderr };
        for (const [name, stream] of Object.entries(streams)) {
            // Сломавшийся поток без слушателя убил бы редактор; состояние процесса
            // от этого не меняется — его ведут `exit`/`error` на нём самом.
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

    /** Снять процесс немедленно и синхронно (SIGKILL); мёртвому — безвредно. */
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

/**
 * Поток построчно: `onLine` на каждую строку без `\n` (и `\r` перед ним);
 * хвост без перевода строки отдаётся по концу потока.
 */
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
        buffer = "";
    });
}
