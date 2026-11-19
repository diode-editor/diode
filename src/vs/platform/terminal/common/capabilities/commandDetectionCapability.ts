// Upstream `commandDetectionCapability.ts` + `commandDetection/terminalCommand.ts`, the Unix path: the shell's
// prompt/command/executed/finished marks become commands. Not ported: `promptInputModel` (a command line without
// `633;E` is read from the buffer between the command start and executed marks — upstream's fallback), the Windows
// heuristics, invalidation on clear, serialization, the bash `history` exit code hack, markers kept per command
// (they serve decorations).

import type { IMarker, Terminal } from "@xterm/headless";

import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";

import type { ITerminalCommand, TerminalCommandLineConfidence } from "./capabilities.ts";

class TerminalCommand implements ITerminalCommand {
    public exitCode: number | undefined;

    public constructor(
        public readonly command: string,
        public readonly commandLineConfidence: TerminalCommandLineConfidence,
        public readonly isTrusted: boolean,
        public readonly cwd: string | undefined,
    ) {}
}

/** Upstream `PartialTerminalCommand`: the command being typed or run. */
interface IPartialCommand {
    /** `A` came: a prompt is to the left of the command. */
    promptStarted?: boolean;
    /** `B`: where the typed command begins, and the cwd at that moment. */
    start?: { readonly marker: IMarker; readonly x: number; readonly cwd: string | undefined };
    /** `633;E`: the line the shell reported. */
    commandLine?: { readonly value: string; readonly isTrusted: boolean };
    /** `C`: the started command. */
    executed?: TerminalCommand;
}

export class CommandDetectionCapability implements IDisposable {
    private readonly commandsList: TerminalCommand[] = [];
    private current: IPartialCommand = {};
    private cwdValue: string | undefined;
    private readonly onCommandExecutedEmitter = new Emitter<ITerminalCommand>();
    private readonly onCommandFinishedEmitter = new Emitter<ITerminalCommand>();

    public constructor(private readonly terminal: Terminal) {}

    /** Finished commands, oldest first. */
    public get commands(): readonly ITerminalCommand[] {
        return this.commandsList;
    }

    /** The command between `C` and `D`. */
    public get executingCommand(): ITerminalCommand | undefined {
        return this.current.executed;
    }

    public get cwd(): string | undefined {
        return this.cwdValue;
    }

    /** `C`: once per command, a repeated `C` is ignored. */
    public readonly onCommandExecuted = this.onCommandExecutedEmitter.event;

    /** `D`: the same object `onCommandExecuted` gave, now with its exit code. */
    public readonly onCommandFinished = this.onCommandFinishedEmitter.event;

    public setCwd(value: string): void {
        this.cwdValue = value;
    }

    public handlePromptStart(): void {
        this.current.promptStarted = true;
    }

    /** No mark in the alternate buffer: like upstream, a command started there never executes. */
    public handleCommandStart(): void {
        this.current.start?.marker.dispose();
        const marker = this.terminal.registerMarker(0);
        this.current.start =
            marker === undefined ? undefined : { marker, x: this.terminal.buffer.active.cursorX, cwd: this.cwdValue };
    }

    public setCommandLine(value: string, isTrusted: boolean): void {
        this.current.commandLine = { value, isTrusted };
    }

    /** Upstream `UnixPtyHeuristics.handleCommandExecuted`: no event without a command start (`B`). */
    public handleCommandExecuted(): void {
        const { start, commandLine, executed, promptStarted } = this.current;
        if (executed !== undefined || start === undefined) return;
        let command: TerminalCommand;
        if (commandLine === undefined) {
            const line = this.readCommandLine(start.marker, start.x);
            // Upstream: `medium` when a prompt is to the left of the command (`A` came, the start isn't at column 0).
            const confidence = promptStarted === true && start.x > 0 ? "medium" : "low";
            command = new TerminalCommand(line, confidence, false, start.cwd);
        } else {
            command = new TerminalCommand(commandLine.value, "high", commandLine.isTrusted, start.cwd);
        }
        this.current.executed = command;
        this.onCommandExecutedEmitter.fire(command);
    }

    /**
     * A `D` without `C` (empty Enter, Ctrl+C at the prompt) runs the command's execution first, as upstream: every
     * end has its start.
     */
    public handleCommandFinished(exitCode: number | undefined): void {
        this.handleCommandExecuted();
        const command = this.current.executed;
        if (command === undefined) return;
        command.exitCode = exitCode;
        this.commandsList.push(command);
        this.current.start?.marker.dispose();
        this.current = {};
        this.onCommandFinishedEmitter.fire(command);
    }

    /** Upstream `extractCommandLine`: the cells from the command start to the cursor (where `C` is parsed). */
    private readCommandLine(start: IMarker, startX: number): string {
        const buffer = this.terminal.buffer.active;
        const end = buffer.baseY + buffer.cursorY;
        let content = "";
        for (let i = start.line; i <= end; i++) {
            const line = buffer.getLine(i);
            if (line === undefined) continue;
            content += line.translateToString(
                true,
                i === start.line ? startX : 0,
                i === end ? buffer.cursorX : this.terminal.cols,
            );
        }
        return content;
    }

    public dispose(): void {
        this.current.start?.marker.dispose();
        this.onCommandExecutedEmitter.dispose();
        this.onCommandFinishedEmitter.dispose();
    }
}
