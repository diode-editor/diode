import { EmbeddedTerminalSession } from "../vs/workbench/contrib/terminal/node/embeddedTerminalSession.ts";

export { findShell } from "./findShell.ts";

/** OSC 633 A — the shell integration script drew a prompt. */
export const PROMPT_START = "\x1b]633;A\x07";

/** The raw PTY output: the emulator swallows OSC 633, the shell integration script is seen only here. */
export class RecordingSession extends EmbeddedTerminalSession {
    public raw = "";

    protected override feedOutput(data: string): void {
        this.raw += data;
        super.feedOutput(data);
    }
}
