// A terminal on an extension pty created by the core — a task terminal with `CustomExecution`
// (upstream `customPtyImplementation`). The subprocess attaches the pty later by instance id
// (upstream `attachPtyToTerminal`); the implementation exists only with an extension host.

import type { TerminalWaitOnExit } from "../browser/terminalService.ts";

export interface IExtensionPtyTerminalOptions {
    readonly name: string;
    /** Line printed before pty output (upstream `initialText` — "Executing task: …"). */
    readonly message?: string;
    readonly waitOnExit?: TerminalWaitOnExit;
}

export interface IExtensionPtyTerminals {
    /** Returns the instance id. */
    createPtyInstance(options: IExtensionPtyTerminalOptions): number;
}
