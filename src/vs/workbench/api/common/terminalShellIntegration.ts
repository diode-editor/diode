// Upstream `extHostTerminalShellIntegration.ts`: `Terminal.shellIntegration` and the shell execution events from what
// the host reports (`terminal.shellIntegration.*`, `terminal.shellExecution.*`).

import type * as vscode from "vscode";

import { RunOnceScheduler } from "../../../base/common/async.ts";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import {
    parseWireTerminalShellExecutionData,
    parseWireTerminalShellExecutionEnd,
    parseWireTerminalShellExecutionStart,
    parseWireTerminalShellIntegration,
    parseWireTerminalShellIntegrationCwd,
    parseWireTerminalShellIntegrationEnv,
} from "./terminalWireParsers.ts";
import { EventEmitter, TerminalShellExecutionCommandLineConfidence, Uri } from "./vscodeTypes.ts";
import type { IWireTerminalCommandLine } from "./wireTypes.ts";

/** Our enum is the d.ts one at runtime; the types differ only by declaration. */
const HIGH =
    TerminalShellExecutionCommandLineConfidence.High as number as vscode.TerminalShellExecutionCommandLineConfidence;

/**
 * Upstream `TerminalShellIntegration.env` (proposed `terminalShellEnv`, not in the stable d.ts): present at runtime,
 * as upstream.
 */
interface ITerminalShellIntegrationEnvironment {
    readonly value: Readonly<Record<string, string>>;
    readonly isTrusted: boolean;
}

/** A terminal of the namespace, by host id: the integration is set on it once and keeps its identity. */
export interface IShellIntegrationTerminal {
    readonly value: vscode.Terminal;
    shellIntegration: vscode.TerminalShellIntegration | undefined;
}

export interface ITerminalShellIntegrations {
    readonly onDidChangeTerminalShellIntegration: vscode.Event<vscode.TerminalShellIntegrationChangeEvent>;
    readonly onDidStartTerminalShellExecution: vscode.Event<vscode.TerminalShellExecutionStartEvent>;
    readonly onDidEndTerminalShellExecution: vscode.Event<vscode.TerminalShellExecutionEndEvent>;
    /** The terminal closed: a running execution ends without a code, its `read()` streams complete. */
    close(id: number): void;
}

/**
 * Upstream `ShellExecutionDataStream` + `AsyncIterableObject`: one `read()`. It gets the data emitted after it was
 * created and completes when the execution ends; it can be iterated more than once, each from the start.
 */
class ExecutionDataStream implements AsyncIterable<string> {
    private readonly chunks: string[] = [];
    private ended = false;
    private waiters: (() => void)[] = [];

    public emit(data: string): void {
        this.chunks.push(data);
        this.wake();
    }

    public end(): void {
        this.ended = true;
        this.wake();
    }

    private wake(): void {
        const waiters = this.waiters;
        this.waiters = [];
        for (const waiter of waiters) waiter();
    }

    public [Symbol.asyncIterator](): AsyncIterator<string, undefined> {
        let i = 0;
        return {
            next: async (): Promise<IteratorResult<string, undefined>> => {
                while (i === this.chunks.length && !this.ended) {
                    await new Promise<void>((resolve) => this.waiters.push(resolve));
                }
                return i < this.chunks.length
                    ? { done: false, value: this.chunks[i++] }
                    : { done: true, value: undefined };
            },
        };
    }
}

/** Upstream `InternalTerminalShellExecution`. */
class ShellExecution {
    public readonly value: vscode.TerminalShellExecution;
    private readonly streams: ExecutionDataStream[] = [];
    private ended = false;

    public constructor(
        private commandLine: vscode.TerminalShellExecutionCommandLine,
        cwd: vscode.Uri | undefined,
    ) {
        const read = (): AsyncIterable<string> => this.read();
        const commandLineOf = (): vscode.TerminalShellExecutionCommandLine => this.commandLine;
        this.value = {
            get commandLine(): vscode.TerminalShellExecutionCommandLine {
                return commandLineOf();
            },
            cwd,
            read,
        };
    }

    /** Upstream: a `read()` after the end is empty; one before gets the data from then on. */
    private read(): AsyncIterable<string> {
        const stream = new ExecutionDataStream();
        if (this.ended) stream.end();
        else this.streams.push(stream);
        return stream;
    }

    public emit(data: string): void {
        for (const stream of this.streams) stream.emit(data);
    }

    /** `commandLine` — the line the shell reported at the end replaces the one from the start. */
    public end(commandLine: vscode.TerminalShellExecutionCommandLine | undefined): void {
        if (commandLine !== undefined) this.commandLine = commandLine;
        this.ended = true;
        for (const stream of this.streams.splice(0)) stream.end();
    }
}

interface IEmitters {
    readonly change: EventEmitter<vscode.TerminalShellIntegrationChangeEvent>;
    readonly start: EventEmitter<vscode.TerminalShellExecutionStartEvent>;
    readonly end: EventEmitter<vscode.TerminalShellExecutionEndEvent>;
}

/** Upstream `InternalTerminalShellIntegration`. */
class ShellIntegration {
    public readonly value: vscode.TerminalShellIntegration;
    private cwd: vscode.Uri | undefined;
    private env: ITerminalShellIntegrationEnvironment | undefined;
    /** `executeCommand` executions waiting for their start. */
    private readonly pending: ShellExecution[] = [];
    private current: ShellExecution | undefined;
    /**
     * Upstream `_currentExecutionProperties`: the current execution is a multi-line `executeCommand` — the lines the
     * shell has not run yet. Each line is a command of its own to the shell, the extension sees one execution: it ends
     * with the last line. Deviation: upstream keeps it per terminal and sets it on the request, so a stale value (a
     * request while another command runs, a multi-line execution cut short) holds back the end of the next execution.
     */
    private unresolvedCommandLines: readonly string[] | undefined;
    /** Ended, its end event not fired yet: it waits for the `read()` streams to complete. */
    private ending: { readonly execution: ShellExecution; readonly exitCode: number | undefined } | undefined;
    private readonly endLater = new RunOnceScheduler(() => {
        this.fireEnding();
    }, 0);

    public constructor(
        private readonly terminal: vscode.Terminal,
        supportsExecuteCommand: boolean,
        private readonly emitters: IEmitters,
        requestExecution: (commandLine: string) => void,
    ) {
        const cwd = (): vscode.Uri | undefined => this.cwd;
        const env = (): ITerminalShellIntegrationEnvironment | undefined => this.env;
        const requestNew = (commandLine: string): vscode.TerminalShellExecution => {
            requestExecution(commandLine);
            const execution = new ShellExecution({ value: commandLine, confidence: HIGH, isTrusted: true }, this.cwd);
            this.pending.push(execution);
            return execution.value;
        };
        this.value = {
            get cwd(): vscode.Uri | undefined {
                return cwd();
            },
            get env(): ITerminalShellIntegrationEnvironment | undefined {
                const value = env();
                return value === undefined
                    ? undefined
                    : Object.freeze({ isTrusted: value.isTrusted, value: Object.freeze({ ...value.value }) });
            },
            executeCommand(commandLineOrExecutable: string, args?: string[]): vscode.TerminalShellExecution {
                if (!supportsExecuteCommand) throw new Error("This terminal does not support the executeCommand API.");
                return requestNew(commandLineOf(commandLineOrExecutable, args));
            },
        } as vscode.TerminalShellIntegration;
    }

    public setCwd(cwd: vscode.Uri | undefined): void {
        if (this.cwd?.toString() === cwd?.toString()) return;
        this.cwd = cwd;
        this.fireChange();
    }

    /** Upstream fires on every report, changed or not. */
    public setEnv(value: Readonly<Record<string, string>>, isTrusted: boolean): void {
        this.env = { value, isTrusted };
        this.fireChange();
    }

    public fireChange(): void {
        this.emitters.change.fire({ terminal: this.terminal, shellIntegration: this.value });
    }

    /**
     * A start ends what is still open: the previous execution's end event goes first, without a code. A line of the
     * running multi-line execution is no new start.
     */
    public start(commandLine: vscode.TerminalShellExecutionCommandLine, cwd: vscode.Uri | undefined): void {
        const lines = splitAndSanitizeCommandLine(commandLine.value);
        // Set only while a multi-line execution is the current one.
        if (this.unresolvedCommandLines !== undefined) {
            const rest = subExecutionRest(this.unresolvedCommandLines, lines);
            if (rest !== undefined) {
                this.unresolvedCommandLines = rest;
                return;
            }
        }
        this.close();
        // Upstream: a high-confidence line matches its `executeCommand` exactly or as the first lines of a multi-line
        // one, a lower one takes the oldest.
        let execution: ShellExecution | undefined;
        if (commandLine.confidence === HIGH) {
            for (const [i, pending] of this.pending.entries()) {
                const requested = pending.value.commandLine.value;
                const rest =
                    requested === commandLine.value
                        ? undefined
                        : subExecutionRest(splitAndSanitizeCommandLine(requested), lines);
                if (requested !== commandLine.value && rest === undefined) continue;
                execution = this.pending.splice(i, 1)[0];
                this.unresolvedCommandLines = rest;
                break;
            }
        } else {
            execution = this.pending.shift();
        }
        this.current = execution ?? new ShellExecution(commandLine, cwd ?? this.cwd);
        this.emitters.start.fire({
            terminal: this.terminal,
            shellIntegration: this.value,
            execution: this.current.value,
        });
    }

    public emit(data: string): void {
        this.current?.emit(data);
    }

    /**
     * Upstream fires the end once the `read()` streams have completed (`flush`): a consumer's `for await` is done
     * with the data by then. A start or a close before that fires it at once.
     */
    public end(commandLine: vscode.TerminalShellExecutionCommandLine, exitCode: number | undefined): void {
        // A multi-line execution ends with its last line, and keeps the line it was requested with.
        if (this.unresolvedCommandLines !== undefined && this.unresolvedCommandLines.length > 0) return;
        const execution = this.current;
        if (execution === undefined) return;
        this.current = undefined;
        execution.end(this.unresolvedCommandLines === undefined ? commandLine : undefined);
        this.unresolvedCommandLines = undefined;
        this.ending = { execution, exitCode };
        this.endLater.schedule();
    }

    /** Ends what is open (a start, the terminal closing): an execution without its end ends without a code. */
    public close(): void {
        this.fireEnding();
        this.unresolvedCommandLines = undefined;
        const execution = this.current;
        if (execution === undefined) return;
        this.current = undefined;
        execution.end(undefined);
        this.fireEnd(execution, undefined);
    }

    /** The timer left behind finds nothing, and the next `end` re-arms it: no need to cancel it. */
    private fireEnding(): void {
        const ending = this.ending;
        if (ending === undefined) return;
        this.ending = undefined;
        this.fireEnd(ending.execution, ending.exitCode);
    }

    private fireEnd(execution: ShellExecution, exitCode: number | undefined): void {
        this.emitters.end.fire({
            terminal: this.terminal,
            shellIntegration: this.value,
            execution: execution.value,
            exitCode,
        });
    }
}

/** Upstream `splitAndSanitizeCommandLine`: the non-empty lines, trimmed. */
function splitAndSanitizeCommandLine(commandLine: string): string[] {
    return commandLine
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}

/**
 * Upstream `isSubExecution`: the shell ran the next of the unresolved lines (one or more of them as one command) — the
 * lines still to run; `undefined` — the command is not a part of the execution. Deviation: an empty command line is
 * not a part of any (upstream takes it for one, and a pending single-line execution for multi-line).
 */
function subExecutionRest(unresolved: readonly string[], lines: readonly string[]): string[] | undefined {
    let i = 0;
    while (i < unresolved.length && i < lines.length && unresolved[i] === lines[i]) i++;
    return i > 0 && i === lines.length ? unresolved.slice(i) : undefined;
}

/** Upstream `executeCommand(executable, args)`: an argument with whitespace and no quotes is wrapped in `"…"`. */
function commandLineOf(commandLineOrExecutable: string, args: readonly string[] | undefined): string {
    let commandLine = commandLineOrExecutable;
    for (const arg of args ?? []) {
        const wrapInQuotes = !/["'`]/u.test(arg) && /\s/u.test(arg);
        commandLine += wrapInQuotes ? ` "${arg}"` : ` ${arg}`;
    }
    return commandLine;
}

/** Upstream `_convertCwdToUri`: an empty cwd is unknown. */
function cwdUri(cwd: string | undefined): vscode.Uri | undefined {
    return cwd === undefined || cwd === "" ? undefined : Uri.file(cwd);
}

function commandLineFromWire(wire: IWireTerminalCommandLine): vscode.TerminalShellExecutionCommandLine {
    return {
        value: wire.value,
        confidence: wire.confidence as number as vscode.TerminalShellExecutionCommandLineConfidence,
        isTrusted: wire.isTrusted,
    };
}

/** Upstream `ExtHostTerminalShellIntegration`; `terminalOf` resolves a host id to the namespace's terminal. */
export function createTerminalShellIntegrations(
    rpc: SubprocessRpc,
    terminalOf: (id: number) => IShellIntegrationTerminal | undefined,
): ITerminalShellIntegrations {
    const emitters: IEmitters = {
        change: new EventEmitter(),
        start: new EventEmitter(),
        end: new EventEmitter(),
    };
    const integrations = new Map<number, ShellIntegration>();

    /** Upstream `$shellIntegrationChange`: the first one creates the integration, every one fires the change. */
    const change = (id: number, supportsExecuteCommand: boolean): void => {
        const terminal = terminalOf(id);
        if (terminal === undefined) return;
        let integration = integrations.get(id);
        if (integration === undefined) {
            integration = new ShellIntegration(terminal.value, supportsExecuteCommand, emitters, (commandLine) => {
                rpc.notify("terminal.shellIntegration.executeCommand", { id, commandLine });
            });
            integrations.set(id, integration);
            terminal.shellIntegration = integration.value;
        }
        integration.fireChange();
    };

    rpc.handleNotification("terminal.shellIntegration.changed", (params) => {
        const event = parseWireTerminalShellIntegration(params);
        if (event !== null) change(event.id, event.supportsExecuteCommand);
    });

    rpc.handleNotification("terminal.shellIntegration.cwd", (params) => {
        const event = parseWireTerminalShellIntegrationCwd(params);
        if (event !== null) integrations.get(event.id)?.setCwd(cwdUri(event.cwd));
    });

    rpc.handleNotification("terminal.shellIntegration.env", (params) => {
        const event = parseWireTerminalShellIntegrationEnv(params);
        if (event !== null) integrations.get(event.id)?.setEnv(event.env, event.isTrusted);
    });

    rpc.handleNotification("terminal.shellExecution.start", (params) => {
        const event = parseWireTerminalShellExecutionStart(params);
        if (event === null) return;
        // Upstream: a start without the change before it (missed on startup) creates the integration.
        if (!integrations.has(event.id)) change(event.id, event.supportsExecuteCommand);
        integrations.get(event.id)?.start(commandLineFromWire(event.commandLine), cwdUri(event.cwd));
    });

    rpc.handleNotification("terminal.shellExecution.data", (params) => {
        const event = parseWireTerminalShellExecutionData(params);
        if (event !== null) integrations.get(event.id)?.emit(event.data);
    });

    rpc.handleNotification("terminal.shellExecution.end", (params) => {
        const event = parseWireTerminalShellExecutionEnd(params);
        if (event !== null) integrations.get(event.id)?.end(commandLineFromWire(event.commandLine), event.exitCode);
    });

    return {
        onDidChangeTerminalShellIntegration: emitters.change.event,
        onDidStartTerminalShellExecution: emitters.start.event,
        onDidEndTerminalShellExecution: emitters.end.event,
        close: (id) => {
            integrations.get(id)?.close();
            integrations.delete(id);
        },
    };
}
