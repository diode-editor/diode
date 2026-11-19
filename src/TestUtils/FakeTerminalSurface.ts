import { FakeTerminalSurface as EngineFakeTerminalSurface } from "@tuidom/testing/FakeTerminalSurface";

import { Emitter } from "../vs/base/common/event.ts";
import type { ShellIntegrationAddon } from "../vs/platform/terminal/common/xterm/shellIntegrationAddon.ts";
import type { ITerminalRelaunchOptions } from "../vs/workbench/contrib/terminal/common/terminalSessionFactory.ts";

export type { FakeCellOptions } from "@tuidom/testing/FakeTerminalSurface";

/**
 * Input fires `onDidInput` and `onDidWriteData` (`sendText` — `onDidSendText`); after exit it is not written but fires
 * `onDidInputAfterExit` — like a real session. Process output is scripted with {@link emitData}.
 */
export class FakeTerminalSurface extends EngineFakeTerminalSurface {
    public pid: number | undefined;
    public readonly relaunches: ITerminalRelaunchOptions[] = [];
    public readonly printed: string[] = [];
    /** `undefined` — never set. */
    public ansiColors: readonly number[] | undefined;
    /** The last `setKittyKeyboardEnabled`; `undefined` — never set. */
    public kittyKeyboardEnabled: boolean | undefined;
    private readonly inputAfterExit = new Emitter<void>();
    public readonly onDidInputAfterExit = this.inputAfterExit.event;
    private readonly input = new Emitter<void>();
    public readonly onDidInput = this.input.event;
    private readonly lineData = new Emitter<string>();
    public readonly onLineData = this.lineData.event;
    private readonly willData = new Emitter<string>();
    public readonly onWillData = this.willData.event;
    private readonly writeData = new Emitter<string>();
    public readonly onDidWriteData = this.writeData.event;
    private readonly sentText = new Emitter<string>();
    public readonly onDidSendText = this.sentText.event;
    private readonly dimensionsChange = new Emitter<void>();
    public readonly onDidChangeDimensions = this.dimensionsChange.event;
    public dimensions = { cols: 80, rows: 24 };
    /** Set by the test before the instance is created (e.g. {@link FakeShellIntegration}); none by default. */
    public shellIntegration: ShellIntegrationAddon | undefined;

    public constructor(
        public shell = "/bin/bash",
        pid?: number,
    ) {
        super();
        this.pid = pid;
    }

    public override write(data: string): void {
        if (this.deliver(data)) this.writeData.fire(data);
    }

    public sendText(text: string): void {
        if (this.deliver(text)) this.sentText.fire(text);
    }

    public override resize(cols: number, rows: number): void {
        super.resize(cols, rows);
        this.dimensions = { cols, rows };
        this.dimensionsChange.fire();
    }

    /** Raw process output, as the session reports it before parsing. */
    public emitData(data: string): void {
        this.willData.fire(data);
    }

    private deliver(data: string): boolean {
        if (this.isExited) {
            this.inputAfterExit.fire();
            return false;
        }
        this.sendInput(data);
        this.input.fire();
        return true;
    }

    /** Where both `write` and `sendText` deliver the input; recorded in `writes`. */
    protected sendInput(data: string): void {
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

    public setKittyKeyboardEnabled(enabled: boolean): void {
        this.kittyKeyboardEnabled = enabled;
    }
}
