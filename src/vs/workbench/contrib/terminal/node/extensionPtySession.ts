// Сессия терминала, процессом которого владеет расширение
// (`window.createTerminal({ name, pty })`, `TerminalProcessExtHostProxy`
// эталона). На нашей стороне только эмулятор (`XtermSurface`): вывод pty
// приезжает по проводу и подаётся `feed`, набор человека и ответы эмулятора
// уходят обратно через `onInput`, смена размера виджета — через `onResize`, а
// `exit` закрывает сессию, когда pty сообщил `onDidClose`. Процесса здесь нет —
// `pid` не бывает, убивать при dispose нечего (pty закроет субпроцесс).

import type { IExtensionPtySession, IExtensionPtySessionOptions } from "../common/terminalSessionFactory.ts";

import { XtermSurface } from "./xtermSurface.ts";

export class ExtensionPtySession extends XtermSurface implements IExtensionPtySession {
    /** Имя терминала расширения — им сессия представляется вместо шелла. */
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

    /**
     * Pty закрылся. Поверхность сообщает выход числом — `onDidClose` без кода
     * даёт 0, а `undefined` до `exitStatus` расширения доносит адаптер.
     */
    public exit(code: number | undefined): void {
        this.markExited(code ?? 0);
    }

    protected sendInput(data: string): void {
        this.options.onInput(data);
    }

    protected onDidResize(cols: number, rows: number): void {
        this.options.onResize(cols, rows);
    }

    /** Процесс — объект расширения: его закрывает субпроцесс (`pty.close()`), не мы. */
    protected disposeProcess(): void {
        // убивать на нашей стороне нечего
    }
}
