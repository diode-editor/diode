import { FakeTerminalSurface as EngineFakeTerminalSurface } from "@tuidom/testing/FakeTerminalSurface";

import { Emitter } from "../vs/base/common/event.ts";
import type { ITerminalRelaunchOptions } from "../vs/workbench/contrib/terminal/common/terminalSessionFactory.ts";

export type { FakeCellOptions } from "@tuidom/testing/FakeTerminalSurface";

/** Input after exit is not written but fires `onDidInputAfterExit` — like a real session. */
export class FakeTerminalSurface extends EngineFakeTerminalSurface {
    public pid: number | undefined;
    public readonly relaunches: ITerminalRelaunchOptions[] = [];
    public readonly printed: string[] = [];
    /** `undefined` — never set. */
    public ansiColors: readonly number[] | undefined;
    private readonly inputAfterExit = new Emitter<void>();
    public readonly onDidInputAfterExit = this.inputAfterExit.event;
    private readonly lineData = new Emitter<string>();
    public readonly onLineData = this.lineData.event;

    public constructor(
        public shell = "/bin/bash",
        pid?: number,
    ) {
        super();
        this.pid = pid;
    }

    public override write(data: string): void {
        if (this.isExited) {
            this.inputAfterExit.fire();
            return;
        }
        super.write(data);
    }

    /** Output lines as the emulator would report them. */
    public emitLines(...lines: string[]): void {
        for (const line of lines) this.lineData.fire(line);
    }

    public relaunch(options: ITerminalRelaunchOptions): void {
        this.relaunches.push(options);
        this.isExited = false;
    }

    public printMessage(text: string): void {
        this.printed.push(text);
    }

    public setAnsiColors(ansi: readonly number[]): void {
        this.ansiColors = ansi;
    }
}
