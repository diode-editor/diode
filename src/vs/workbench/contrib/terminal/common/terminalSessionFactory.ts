import type { ITerminalSurface } from "@tuidom/core/common/iTerminalSurface";

import type { Event } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";

import type { ITerminalBuffer } from "./terminalBuffer.ts";

export interface ITerminalSessionOptions {
    cols: number;
    rows: number;
    shell?: string;
    args?: string[];
    cwd?: string;
    /** Applied over the inherited environment; `null` unsets a variable (`TerminalOptions.env`). */
    env?: Record<string, string | null>;
    /** `true`: the shell environment is exactly `env`, not inherited from the process (`TerminalOptions.strictEnv`). */
    strictEnv?: boolean;
    /** Printed to the emulator before shell output (upstream `initialText`); never sent to the shell. */
    message?: string;
}

export type ITerminalRelaunchOptions = Omit<ITerminalSessionOptions, "cols" | "rows"> & {
    /** Clear the emulator buffer before the new process (task `presentation.clear`). */
    clear?: boolean;
};

export type ITerminalSession = ITerminalSurface &
    IDisposable & {
        readonly shell: string;
        /** `undefined` when there is no process on our side (extension pty). */
        readonly pid: number | undefined;
        /**
         * The process has exited — start a new one in the same emulator (upstream `reuseTerminal`). An extension
         * pty ignores the shell fields: the extension attaches the new process.
         */
        relaunch(options: ITerminalRelaunchOptions): void;
        /** The text isn't sent to the process. */
        printMessage(text: string): void;
        /** Indices 0..15; recolors already printed output too. */
        setAnsiColors(ansi: readonly number[]): void;
        /** Key press for "press any key to close" (upstream `waitOnExit`). */
        readonly onDidInputAfterExit: Event<void>;
        /**
         * Upstream `onLineData`: each output line once complete (the unterminated last one on exit, before
         * `onExit`), wrapped rows joined, without escape sequences. Task problem matchers read it.
         */
        readonly onLineData: Event<string>;
        /** The emulator buffer for link detection; absent or `undefined` — no links. */
        readonly buffer?: ITerminalBuffer | undefined;
        /**
         * The process's current working directory, else its initial one; `undefined` when there is no process
         * on our side. Relative paths in the output resolve against it (upstream reads it from shell integration).
         */
        getCwd?(): Promise<string | undefined>;
    };

export type TerminalSessionFactory = (options: ITerminalSessionOptions) => ITerminalSession;

export const TerminalSessionFactoryDIToken = token<TerminalSessionFactory>("TerminalSessionFactory");

/** The extension owns the process (`window.createTerminal({ pty })`): only the emulator is on our side. */
export interface IExtensionPtySession extends ITerminalSession {
    feed(data: string): void;
    exit(code: number | undefined): void;
}

export interface IExtensionPtySessionOptions {
    cols: number;
    rows: number;
    /** Terminal name; the session reports it instead of a shell (`shell`). */
    name: string;
    onInput(data: string): void;
    onResize(cols: number, rows: number): void;
}

export type ExtensionPtySessionFactory = (options: IExtensionPtySessionOptions) => IExtensionPtySession;

export const ExtensionPtySessionFactoryDIToken = token<ExtensionPtySessionFactory>("ExtensionPtySessionFactory");
