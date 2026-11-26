// Upstream `src/vs/platform/terminal/common/capabilities/capabilities.ts`: what shell integration tells about a
// terminal. Only the capabilities the extension API reads are ported (command, cwd and environment detection);
// partial command, prompt type and buffer mark detection serve upstream UI and Windows.

/** Upstream `ITerminalCommand.commandLineConfidence`: `high` — the shell reported it (`633;E`), else read from the buffer. */
export type TerminalCommandLineConfidence = "low" | "medium" | "high";

/** A command the shell ran: one object from `onCommandExecuted` to `onCommandFinished`. */
export interface ITerminalCommand {
    readonly command: string;
    readonly commandLineConfidence: TerminalCommandLineConfidence;
    /** The command line came with the terminal's nonce (`633;E;<line>;<nonce>`). */
    readonly isTrusted: boolean;
    /** The shell's cwd when the command started; `undefined` — the shell never reported one. */
    readonly cwd: string | undefined;
    /** `undefined` until it finishes and when the shell reports no code (`D` alone: empty Enter, Ctrl+C). */
    readonly exitCode: number | undefined;
}

/** Upstream `TerminalShellIntegrationEnvironment`. */
export interface ITerminalShellEnvironment {
    readonly value: Readonly<Record<string, string>>;
    readonly isTrusted: boolean;
}
