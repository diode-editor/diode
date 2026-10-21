// Extension pty session (upstream `TerminalProcessExtHostProxy`): only the emulator is on our side, there is no
// process — no `pid`, nothing to kill on dispose (the subprocess closes the pty).

import type { IExtensionPtySession, IExtensionPtySessionOptions } from "../common/terminalSessionFactory.ts";

import { XtermSurface } from "./xtermSurface.ts";

export class ExtensionPtySession extends XtermSurface implements IExtensionPtySession {
    public readonly shell: string;
    /** No process on our side — the extension sees `Terminal.processId` as `undefined`. */
    public readonly pid = undefined;

    public constructor(private readonly options: IExtensionPtySessionOptions) {
        super({ cols: options.cols, rows: options.rows });
        this.shell = options.name;
    }

    public feed(data: string): void {
        if (this.isExited) return;
        this.feedOutput(data);
    }

    /** `onDidClose` without a code yields 0; the adapter carries `undefined` to the extension's `exitStatus`. */
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
        // nothing to kill on our side
    }

    /** The extension attaches the new pty (`CustomExecution` on a task rerun). */
    protected relaunchProcess(): void {
        // nothing to launch on our side
    }
}
