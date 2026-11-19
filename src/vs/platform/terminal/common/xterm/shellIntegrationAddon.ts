// Upstream `src/vs/platform/terminal/common/xterm/shellIntegrationAddon.ts`: reads the shell integration sequences
// (`OSC Ps ; Pt ST`) and feeds the terminal's capabilities. Handled: 633 (VS Code), 133 (FinalTerm), 7 (cwd URI),
// 1337 (iTerm `CurrentDir`, `SetMark`). Not ported: OSC 9;9 (Windows cwd), telemetry, the status and seen-sequences
// events, buffer marks (`SetMark` is accepted and ignored), the prompt input model inputs (`Prompt`,
// `ContinuationPrompt`, continuation and right prompt positions), `PromptType`, `IsWindows`, `Task`.
// Deviation: an unknown `633;P` key is not handled (`false`) — upstream falls through to `SetMark` and adds a mark.

import type { Terminal } from "@xterm/headless";

import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ITerminalCommand } from "../capabilities/capabilities.ts";
import { CommandDetectionCapability } from "../capabilities/commandDetectionCapability.ts";
import { CwdDetectionCapability } from "../capabilities/cwdDetectionCapability.ts";
import { ShellEnvDetectionCapability } from "../capabilities/shellEnvDetectionCapability.ts";
import { TerminalCapabilityStore } from "../capabilities/terminalCapabilityStore.ts";

/** Upstream `ShellIntegrationOscPs`. */
const OSC_FINAL_TERM = 133;
const OSC_VSCODE = 633;
const OSC_ITERM = 1337;
const OSC_SET_CWD = 7;

/** Upstream `_onProcessData`: process output is cut before and after these, so each is parsed in its own write. */
// eslint-disable-next-line no-control-regex -- ESC and BEL delimit the sequence
const COMMAND_BOUNDARY = /\x1b\][16]33;(?:C|D(?:;\d+)?)\x07/g;

/** A chunk of a command's output: process data from `C` (the sequence included) to `D` (excluded). */
export interface ITerminalCommandOutput {
    readonly command: ITerminalCommand;
    readonly data: string;
}

export class ShellIntegrationAddon implements IDisposable {
    public readonly capabilities = new TerminalCapabilityStore();
    private readonly onDidWriteCommandOutputEmitter = new Emitter<ITerminalCommandOutput>();

    /**
     * Process output of the executing command, raw, as each piece is parsed. It starts with the `C` sequence itself (Roo
     * Code and Cline look for it) and never has `D`, as upstream: `C` and `D` are parsed in writes of their own
     * ({@link splitProcessData}); the command starts while the `C` write is parsed and its data is reported after the
     * parse, while `D` ends the command before its write is reported.
     */
    public readonly onDidWriteCommandOutput = this.onDidWriteCommandOutputEmitter.event;

    public constructor(private readonly nonce: string) {}

    public activate(terminal: Terminal): void {
        terminal.parser.registerOscHandler(OSC_VSCODE, (data) => this.handleVSCodeSequence(terminal, data));
        terminal.parser.registerOscHandler(OSC_ITERM, (data) => this.handleITermSequence(data));
        terminal.parser.registerOscHandler(OSC_FINAL_TERM, (data) => this.handleFinalTermSequence(terminal, data));
        terminal.parser.registerOscHandler(OSC_SET_CWD, (data) => this.handleSetCwd(data));
    }

    /** One piece of process data the emulator has parsed (upstream `onData`). */
    public handleParsedData(data: string): void {
        const command = this.capabilities.get("commandDetection")?.executingCommand;
        if (command !== undefined) this.onDidWriteCommandOutputEmitter.fire({ command, data });
    }

    /** A new shell process in the same emulator (a relaunch): what the previous one reported is gone. */
    public reset(): void {
        this.capabilities.clear();
    }

    private handleFinalTermSequence(terminal: Terminal, data: string): boolean {
        const [command, ...args] = data.split(";");
        switch (command) {
            case "A":
                this.commandDetection(terminal).handlePromptStart();
                return true;
            case "B":
                this.commandDetection(terminal).handleCommandStart();
                return true;
            case "C":
                this.commandDetection(terminal).handleCommandExecuted();
                return true;
            case "D":
                this.commandDetection(terminal).handleCommandFinished(
                    args.length === 1 ? parseInt(args[0], 10) : undefined,
                );
                return true;
        }
        return false;
    }

    private handleVSCodeSequence(terminal: Terminal, data: string): boolean {
        const argsIndex = data.indexOf(";");
        const command = argsIndex === -1 ? data : data.substring(0, argsIndex);
        const args: (string | undefined)[] = argsIndex === -1 ? [] : data.substring(argsIndex + 1).split(";");
        switch (command) {
            case "A":
                this.commandDetection(terminal).handlePromptStart();
                return true;
            case "B":
                this.commandDetection(terminal).handleCommandStart();
                return true;
            case "C":
                this.commandDetection(terminal).handleCommandExecuted();
                return true;
            case "D":
                this.commandDetection(terminal).handleCommandFinished(
                    args[0] === undefined ? undefined : parseInt(args[0], 10),
                );
                return true;
            case "E":
                this.commandDetection(terminal).setCommandLine(
                    args[0] === undefined ? "" : deserializeVSCodeOscMessage(args[0]),
                    args[1] === this.nonce,
                );
                return true;
            // Continuation and right prompt positions feed upstream's prompt input model.
            case "F":
            case "G":
            case "H":
            case "I":
                this.commandDetection(terminal);
                return true;
            case "P":
                return this.handleProperty(terminal, args);
            case "EnvJson":
                return this.handleEnvJson(args);
            case "EnvSingleStart":
                this.shellEnvDetection().startEnvironmentSingleVar(args[0] === "1", args[1] === this.nonce);
                return true;
            case "EnvSingleEntry":
                // Stryker disable next-line ConditionalExpression: equivalent: `split` fills args from the first, a second one means a first
                if (args[0] !== undefined && args[1] !== undefined)
                    this.shellEnvDetection().setEnvironmentSingleVar(
                        args[0],
                        deserializeVSCodeOscMessage(args[1]),
                        args[2] === this.nonce,
                    );
                return true;
            case "EnvSingleDelete":
                // Stryker disable next-line ConditionalExpression: equivalent: `split` fills args from the first, a second one means a first
                if (args[0] !== undefined && args[1] !== undefined)
                    this.shellEnvDetection().deleteEnvironmentSingleVar(args[0], args[2] === this.nonce);
                return true;
            case "EnvSingleEnd":
                this.shellEnvDetection().endEnvironmentSingleVar(args[0] === this.nonce);
                return true;
            case "SetMark":
                return true;
        }
        return false;
    }

    /** `633;P;<key>=<value>`; a value without `=` is accepted and ignored, as upstream. */
    private handleProperty(terminal: Terminal, args: readonly (string | undefined)[]): boolean {
        // Stryker disable next-line StringLiteral: equivalent: any text without `=` is a key without a value
        const { key, value } = parseKeyValueAssignment(deserializeVSCodeOscMessage(args[0] ?? ""));
        if (value === undefined) return true;
        switch (key) {
            case "Cwd":
                // Upstream: the nonce is present only from a trusted shell integration script; without it the cwd
                // may have been spoofed through arbitrary output.
                this.updateCwd(value, args[1] === this.nonce);
                return true;
            case "IsWindows":
            case "HasRichCommandDetection":
            case "ContinuationPrompt":
            case "Prompt":
                this.commandDetection(terminal);
                return true;
            case "PromptType":
            case "Task":
                return true;
        }
        return false;
    }

    private handleEnvJson(args: readonly (string | undefined)[]): boolean {
        // Stryker disable next-line ConditionalExpression,BooleanLiteral: equivalent: without the guard the missing value throws in the `try` below and the environment stays as well
        if (args[0] === undefined) return true;
        let env: unknown;
        try {
            env = JSON.parse(deserializeVSCodeOscMessage(args[0]));
        } catch {
            // Upstream logs a warning and keeps the previous environment.
        }
        if (typeof env === "object" && env !== null)
            this.shellEnvDetection().setEnvironment(env as Record<string, unknown>, args[1] === this.nonce);
        return true;
    }

    /** iTerm2 interprets no escapes in the value and has no nonce: never trusted. */
    private handleITermSequence(data: string): boolean {
        // `SetMark` is a key without a value: accepted and ignored.
        const [command] = data.split(";");
        const { key, value } = parseKeyValueAssignment(command);
        if (value === undefined) return true;
        if (key !== "CurrentDir") return false;
        this.updateCwd(value, false);
        return true;
    }

    /** `OSC 7 ; file://<host>/<path> ST`, the path percent-encoded; no nonce — never trusted. */
    private handleSetCwd(data: string): boolean {
        const [command] = data.split(";");
        if (!/^file:\/\/.*\//.test(command)) return false;
        const { path } = Uri.parse(command);
        this.updateCwd(path, false);
        return true;
    }

    private updateCwd(value: string, isTrusted: boolean): void {
        const cwd = sanitizeCwd(value);
        this.cwdDetection().updateCwd(cwd, isTrusted);
        this.capabilities.get("commandDetection")?.setCwd(cwd);
    }

    private commandDetection(terminal: Terminal): CommandDetectionCapability {
        let capability = this.capabilities.get("commandDetection");
        if (capability === undefined) {
            capability = new CommandDetectionCapability(terminal);
            this.capabilities.add("commandDetection", capability);
        }
        return capability;
    }

    private cwdDetection(): CwdDetectionCapability {
        let capability = this.capabilities.get("cwdDetection");
        if (capability === undefined) {
            capability = new CwdDetectionCapability();
            this.capabilities.add("cwdDetection", capability);
        }
        return capability;
    }

    private shellEnvDetection(): ShellEnvDetectionCapability {
        let capability = this.capabilities.get("shellEnvDetection");
        if (capability === undefined) {
            capability = new ShellEnvDetectionCapability();
            this.capabilities.add("shellEnvDetection", capability);
        }
        return capability;
    }

    public dispose(): void {
        this.capabilities.dispose();
        // Stryker disable next-line CallExpression: equivalent: with the store empty no command runs, nothing fires; this frees the listeners
        this.onDidWriteCommandOutputEmitter.dispose();
    }
}

/**
 * Upstream `_onProcessData`: the data split so that each `C` and `D` sequence is a piece of its own. Upstream does it per
 * chunk: a sequence cut between two chunks stays inside one (the emulator still parses it). Unlike upstream, the empty
 * pieces around a sequence are dropped; data without sequences, an empty chunk too, is one piece.
 */
export function splitProcessData(data: string): string[] {
    const pieces: string[] = [];
    let i = 0;
    for (const match of data.matchAll(COMMAND_BOUNDARY)) {
        pieces.push(data.substring(i, match.index), match[0]);
        i = match.index + match[0].length;
    }
    if (i === 0) return [data];
    pieces.push(data.substring(i));
    return pieces.filter((piece) => piece !== "");
}

/** Upstream: `\\` is a backslash, `\xAB` the character with that hex code. */
export function deserializeVSCodeOscMessage(message: string): string {
    return message.replaceAll(/\\(\\|x([0-9a-f]{2}))/gi, (_match: string, op: string, hex?: string) =>
        hex === undefined ? op : String.fromCharCode(parseInt(hex, 16)),
    );
}

export function parseKeyValueAssignment(message: string): { key: string; value: string | undefined } {
    const separatorIndex = message.indexOf("=");
    if (separatorIndex === -1) return { key: message, value: undefined };
    return { key: message.substring(0, separatorIndex), value: message.substring(separatorIndex + 1) };
}

/** Upstream `sanitizeCwd` without the Windows drive letter: a cwd wrapped in quotes loses them. */
function sanitizeCwd(cwd: string): string {
    return /^['"].*['"]$/.test(cwd) ? cwd.substring(1, cwd.length - 1) : cwd;
}
