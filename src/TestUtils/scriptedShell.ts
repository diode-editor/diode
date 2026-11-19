import type { ITerminalSessionOptions } from "../vs/workbench/contrib/terminal/common/terminalSessionFactory.ts";
import { ExtensionPtySession } from "../vs/workbench/contrib/terminal/node/extensionPtySession.ts";

/** An OSC 633 sequence of the shell integration script. */
export const osc633 = (body: string): string => `\x1b]633;${body}\x07`;

/** A real emulator over no process: what the test feeds is what a shell would have written, its input is recorded. */
export class ScriptedShell extends ExtensionPtySession {
    public readonly input: string[];
    public readonly sessionOptions: ITerminalSessionOptions;

    public constructor(options: ITerminalSessionOptions) {
        const input: string[] = [];
        super({
            cols: options.cols,
            rows: options.rows,
            name: options.shell ?? "/bin/bash",
            onInput: (data) => input.push(data),
            onResize: () => undefined,
            ...(options.shellIntegrationNonce !== undefined
                ? { shellIntegrationNonce: options.shellIntegrationNonce }
                : {}),
        });
        this.input = input;
        this.sessionOptions = options;
    }

    /** The nonce the shell got as `VSCODE_NONCE`. */
    public get nonce(): string {
        return this.shellIntegrationNonce;
    }
}

/** The emulator is a lazy chunk and parses asynchronously; the in-process RPC pair sends via a microtask. */
export async function drain(ms = 0): Promise<void> {
    if (ms > 0) await new Promise<void>((r) => setTimeout(r, ms));
    for (let i = 0; i < 10; i++) await new Promise<void>((r) => setTimeout(r, 0));
}
