// Сессия pty расширения (`TerminalProcessExtHostProxy` эталона): на нашей стороне только эмулятор,
// процесса нет — `pid` не бывает, убивать при dispose нечего (pty закроет субпроцесс).

import type { IExtensionPtySession, IExtensionPtySessionOptions } from "../common/terminalSessionFactory.ts";

import { XtermSurface } from "./xtermSurface.ts";

export class ExtensionPtySession extends XtermSurface implements IExtensionPtySession {
    public readonly shell: string;
    /** Процесса на нашей стороне нет — `Terminal.processId` у расширения `undefined`. */
    public readonly pid = undefined;

    public constructor(private readonly options: IExtensionPtySessionOptions) {
        super({ cols: options.cols, rows: options.rows });
        this.shell = options.name;
    }

    public feed(data: string): void {
        if (this.isExited) return;
        this.feedOutput(data);
    }

    /** `onDidClose` без кода даёт 0; `undefined` до `exitStatus` расширения доносит адаптер. */
    public exit(code: number | undefined): void {
        this.markExited(code ?? 0);
    }

    protected sendInput(data: string): void {
        this.options.onInput(data);
    }

    protected onDidResize(cols: number, rows: number): void {
        this.options.onResize(cols, rows);
    }

    protected disposeProcess(): void {
        // убивать на нашей стороне нечего
    }

    /** Новый pty подключит расширение (`CustomExecution` при повторном запуске задачи). */
    protected relaunchProcess(): void {
        // запускать на нашей стороне нечего
    }
}
