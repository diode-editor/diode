import type {
    IExtensionPtySession,
    IExtensionPtySessionOptions,
} from "../vs/workbench/contrib/terminal/common/terminalSessionFactory.ts";

import { FakeTerminalSurface } from "./FakeTerminalSurface.ts";

export class FakeExtensionPtySession extends FakeTerminalSurface implements IExtensionPtySession {
    public readonly fed: string[] = [];

    public constructor(private readonly options: IExtensionPtySessionOptions) {
        super(options.name);
    }

    public feed(data: string): void {
        this.fed.push(data);
        this.emitUpdate();
    }

    public exit(code: number | undefined): void {
        this.isExited = true;
        this.emitExit(code ?? 0);
    }

    public override write(data: string): void {
        super.write(data);
        this.options.onInput(data);
    }

    public override resize(cols: number, rows: number): void {
        super.resize(cols, rows);
        this.options.onResize(cols, rows);
    }
}
