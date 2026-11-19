// Upstream `commandDetectionCapability.ts` + `commandDetection/terminalCommand.ts`, the Unix path: the shell's
// prompt/command/executed/finished marks become commands, and the prompt input model the minimal slice of upstream's.
// Not ported: reading the command line from the prompt input model (a command line without `633;E` is read from the
// buffer between the command start and executed marks — upstream's fallback), the Windows
// heuristics, invalidation on clear, serialization, the bash `history` exit code hack, markers kept per command
// (they serve decorations).

import type { IMarker, Terminal } from "@xterm/headless";

import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";

import type { ITerminalCommand, TerminalCommandLineConfidence } from "./capabilities.ts";
import { PromptInputModel } from "./commandDetection/promptInputModel.ts";

class TerminalCommand implements ITerminalCommand {
    public exitCode: number | undefined;

    public constructor(
        public command: string,
        public commandLineConfidence: TerminalCommandLineConfidence,
        public isTrusted: boolean,
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
    private cwd: string | undefined;
    private readonly onCommandExecutedEmitter = new Emitter<ITerminalCommand>();
    private readonly onCommandFinishedEmitter = new Emitter<ITerminalCommand>();

    public readonly promptInputModel: PromptInputModel;

    public constructor(private readonly terminal: Terminal) {
        this.promptInputModel = new PromptInputModel(terminal);
    }

    /** Finished commands, oldest first. */
    public get commands(): readonly ITerminalCommand[] {
        return this.commandsList;
    }

    /** The command between `C` and `D`. */
    public get executingCommand(): ITerminalCommand | undefined {
        return this.current.executed;
    }

    /** `C`: once per command, a repeated `C` is ignored. */
    public readonly onCommandExecuted = this.onCommandExecutedEmitter.event;

    /** `D`: the same object `onCommandExecuted` gave, now with its exit code. */
    public readonly onCommandFinished = this.onCommandFinishedEmitter.event;

    public setCwd(value: string): void {
        this.cwd = value;
    }

    public handlePromptStart(): void {
        this.current.promptStarted = true;
    }

    /** No mark in the alternate buffer: like upstream, a command started there never executes. */
    public handleCommandStart(): void {
        this.current.start?.marker.dispose();
        const marker = this.terminal.registerMarker(0);
        if (marker === undefined) {
            this.current.start = undefined;
            return;
        }
        const x = this.terminal.buffer.active.cursorX;
        this.current.start = { marker, x, cwd: this.cwd };
        this.promptInputModel.handleCommandStart(marker, x);
    }

    /**
     * An `E` after `C` still sets the running command's line, as upstream sets its partial command's: fish 4 sends its
     * own `133;C` before the script's `633;E`, so the start carries the buffer's line and the end the reported one.
     */
    public setCommandLine(value: string, isTrusted: boolean): void {
        this.current.commandLine = { value, isTrusted };
        const { executed } = this.current;
        if (executed === undefined) return;
        executed.command = value;
        executed.commandLineConfidence = "high";
        executed.isTrusted = isTrusted;
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
        // The mark only serves reading the line above.
        start.marker.dispose();
        this.promptInputModel.handleCommandExecuted();
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
            // A start trimmed out of the scrollback has a disposed mark, its line is -1.
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
        this.promptInputModel.dispose();
        this.onCommandExecutedEmitter.dispose();
        this.onCommandFinishedEmitter.dispose();
    }
}
