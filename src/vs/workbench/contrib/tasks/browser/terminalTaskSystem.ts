// Task event order matches upstream: Start → Active → ProcessStarted → … →
// ProcessEnded → Inactive → End (plus Terminated if the terminal was closed).
// Problem matchers are not run (docs/TODO/Tasks.md).

import * as paths from "node:path";

import { Emitter } from "../../../../base/common/event.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import { formatMessageForTerminal } from "../../../../platform/terminal/common/terminalStrings.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import {
    type ITerminalInstance,
    TERMINAL_VIEW_ID,
    type TerminalExitReason,
    type TerminalService,
    type TerminalWaitOnExit,
} from "../../terminal/browser/terminalService.ts";
import type { DefaultShellResolver } from "../../terminal/common/defaultShell.ts";
import type { IExtensionPtyTerminals } from "../../terminal/common/extensionPtyTerminals.ts";
import type { TaskPlatform } from "../common/taskConfiguration.ts";
import {
    type CommandString,
    getMapKey,
    getTaskFolder,
    type IPresentationOptions,
    type IShellConfiguration,
    type IShellQuotingOptions,
    type ITask,
    type ShellQuoting,
} from "../common/tasks.ts";
import { type ITaskVariableContext, resolveVariables } from "../common/taskVariables.ts";

export type ITaskEvent =
    | { readonly kind: "changed" }
    | {
          readonly kind: "start";
          readonly task: ITask;
          readonly terminalId: number;
          /** The definition with variables substituted; `CustomExecution` receives it. */
          readonly resolvedDefinition: Readonly<Record<string, unknown>>;
      }
    | { readonly kind: "processStarted"; readonly task: ITask; readonly terminalId: number; readonly processId: number }
    | {
          readonly kind: "processEnded";
          readonly task: ITask;
          readonly terminalId: number;
          readonly exitCode: number | undefined;
      }
    | { readonly kind: "active" | "inactive" | "end"; readonly task: ITask; readonly terminalId: number }
    | {
          readonly kind: "terminated";
          readonly task: ITask;
          readonly terminalId: number;
          readonly exitReason: TerminalExitReason;
      };

/** `exitCode: undefined` means the terminal was closed. */
export interface ITaskSummary {
    readonly exitCode: number | undefined;
}

export type ITaskExecuteResult =
    | { readonly kind: "started"; readonly task: ITask; readonly promise: Promise<ITaskSummary> }
    | { readonly kind: "active"; readonly task: ITask; readonly promise: Promise<ITaskSummary> };

/** Terminal process kind: only terminals of the same kind are reused. */
type TerminalKind = "process" | "custom";

interface ITerminalData {
    /** `getMapKey` of this terminal's last task. */
    lastTask: string;
    readonly group: string | undefined;
    readonly kind: TerminalKind;
}

interface IIdleTerminal {
    readonly key: string;
    readonly id: number;
    readonly data: ITerminalData;
}

interface IActiveTask {
    readonly task: ITask;
    readonly terminalId: number;
    readonly terminal: ITerminalData;
    readonly summary: PromiseWithResolvers<ITaskSummary>;
}

interface ILaunch {
    readonly kind: TerminalKind;
    readonly name: string;
    readonly shellPath?: string;
    readonly shellArgs?: readonly string[];
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string>>;
    readonly message?: string;
    readonly waitOnExit: TerminalWaitOnExit;
    readonly resolvedDefinition: Readonly<Record<string, unknown>>;
}

export interface ITaskRunContext {
    readonly variables: ITaskVariableContext;
    readonly platform: TaskPlatform;
}

/** Upstream's `_shellQuotes`. */
const POSIX_QUOTES: IShellQuotingOptions = {
    escape: { escapeChar: "\\", charsToEscape: " \"'" },
    strong: "'",
    weak: '"',
};
const POWERSHELL_QUOTES: IShellQuotingOptions = {
    escape: { escapeChar: "`", charsToEscape: " \"'()" },
    strong: "'",
    weak: '"',
};
const SHELL_QUOTES: ReadonlyMap<string, IShellQuotingOptions> = new Map([
    ["cmd", { strong: '"' }],
    ["powershell", POWERSHELL_QUOTES],
    ["bash", POSIX_QUOTES],
    ["zsh", POSIX_QUOTES],
]);
/** Upstream's `_osShellQuotes`: for a shell not in the table. */
const OS_SHELL_QUOTES: Readonly<Record<TaskPlatform, IShellQuotingOptions>> = {
    linux: POSIX_QUOTES,
    osx: POSIX_QUOTES,
    windows: POWERSHELL_QUOTES,
};

/** Upstream's `getWaitOnExitValue`. */
export function waitOnExitOf(presentation: IPresentationOptions, isBackground: boolean): TerminalWaitOnExit {
    if (presentation.close !== true) {
        if (presentation.reveal !== "never" || !isBackground || presentation.close === false) {
            if (presentation.panel === "new") return () => "Press any key to close the terminal.";
            if (presentation.showReuseMessage)
                return () => "Terminal will be reused by tasks, press any key to close it.";
            return true;
        }
    }
    return !presentation.close;
}

export class TerminalTaskSystem extends Disposable {
    /** Keyed by `getMapKey`. */
    private readonly active = new Map<string, IActiveTask>();
    private readonly terminals = new Map<number, ITerminalData>();
    /** `dedicated` (upstream's `_sameTaskTerminals`). */
    private readonly sameTaskTerminals = new Map<string, IIdleTerminal>();
    /** `shared`: last released goes first (upstream's `Touch.AsOld`). */
    private idleTaskTerminals: IIdleTerminal[] = [];
    private lastTask: { readonly task: ITask; readonly launch: ILaunch } | undefined;
    private customTerminals: IExtensionPtyTerminals | undefined;

    private readonly onDidStateChangeEmitter = this.register(new Emitter<ITaskEvent>());
    public readonly onDidStateChange = this.onDidStateChangeEmitter.event;

    public constructor(
        private readonly terminalService: TerminalService,
        private readonly views: ViewsService,
        private readonly defaultShell: DefaultShellResolver,
    ) {
        super();
        this.register(
            terminalService.onDidExitInstance((instance) => {
                this.handleExit(instance.id, instance.exitCode, undefined);
            }),
        );
        this.register(
            terminalService.onDidDisposeInstance((instance) => {
                this.handleExit(instance.id, instance.exitCode, instance.exitReason);
                this.forgetTerminal(instance.id);
            }),
        );
    }

    /** Without the bridge there is nothing to run a `CustomExecution` task with. */
    public setCustomExecutionTerminals(terminals: IExtensionPtyTerminals | undefined): void {
        this.customTerminals = terminals;
    }

    public getActiveTasks(): readonly ITask[] {
        return [...this.active.values()].map((a) => a.task);
    }

    /**
     * If the same task is already running, returns `active` with its promise; the service decides (`instancePolicy`).
     * A variable that cannot be resolved is a refusal.
     */
    public run(task: ITask, context: ITaskRunContext): ITaskExecuteResult {
        const running = this.active.get(getMapKey(task));
        if (running !== undefined) return { kind: "active", task: running.task, promise: running.summary.promise };
        return this.execute(task, this.launchOf(task, context));
    }

    /** With `reevaluateOnRerun` variables are recomputed; without it, the run reuses the previous launch. */
    public rerun(context: ITaskRunContext): ITaskExecuteResult | undefined {
        if (this.lastTask === undefined) return undefined;
        const { task, launch } = this.lastTask;
        if (task.runOptions.reevaluateOnRerun) return this.run(task, context);
        const running = this.active.get(getMapKey(task));
        if (running !== undefined) return { kind: "active", task: running.task, promise: running.summary.promise };
        return this.execute(task, launch);
    }

    /** Closes the terminal; the task ends with a Terminated event. */
    public async terminate(task: ITask): Promise<boolean> {
        const running = this.active.get(getMapKey(task));
        if (running === undefined) return false;
        this.terminalService.closeInstance(running.terminalId, "user");
        await running.summary.promise;
        return true;
    }

    public async terminateAll(): Promise<void> {
        await Promise.all(this.getActiveTasks().map((task) => this.terminate(task)));
    }

    /** A running task's terminal, otherwise the one where it ran last. */
    public revealTask(task: ITask): boolean {
        const id = this.terminalOf(task);
        if (id === undefined) return false;
        this.show(id, false);
        return true;
    }

    public isTaskVisible(task: ITask): boolean {
        const id = this.terminalOf(task);
        return (
            id !== undefined &&
            this.views.isViewShown(TERMINAL_VIEW_ID) &&
            // Stryker disable next-line OptionalChaining: equivalent: a task with a terminal always has an active instance (removed ones are forgotten)
            this.terminalService.getActiveInstance()?.id === id
        );
    }

    private terminalOf(task: ITask): number | undefined {
        const key = getMapKey(task);
        const running = this.active.get(key);
        if (running !== undefined) return running.terminalId;
        for (const [id, data] of this.terminals) if (data.lastTask === key) return id;
        return undefined;
    }

    private execute(task: ITask, launch: ILaunch): ITaskExecuteResult {
        const key = getMapKey(task);
        const [instance, terminal] = this.acquireTerminal(task, launch);
        const active: IActiveTask = {
            task,
            terminalId: instance.id,
            terminal,
            summary: Promise.withResolvers<ITaskSummary>(),
        };
        this.active.set(key, active);
        this.lastTask = { task, launch };
        this.fire({ kind: "start", task, terminalId: instance.id, resolvedDefinition: launch.resolvedDefinition });
        this.fire({ kind: "active", task, terminalId: instance.id });
        // Our shell process is ready immediately (pid is known at creation); an extension
        // pty has no process, upstream reports pid -1 (`ExtHostPseudoterminal`).
        this.fire({ kind: "processStarted", task, terminalId: instance.id, processId: instance.processId ?? -1 });
        this.reveal(task, instance.id);
        this.fire({ kind: "changed" });
        return { kind: "started", task, promise: active.summary.promise };
    }

    /**
     * Reuses an idle terminal (`dedicated`: its own; `shared`: its own or one of the same `presentation.group`)
     * or creates a new one.
     */
    private acquireTerminal(task: ITask, launch: ILaunch): [ITerminalInstance, ITerminalData] {
        const key = getMapKey(task);
        const { panel, group, clear } = task.command.presentation;
        const reuse = this.takeTerminalToReuse(key, panel, group, launch.kind);
        if (reuse !== undefined) {
            // An idle terminal is always relaunched: a removed one is already forgotten (`forgetTerminal`).
            const relaunched = this.terminalService.relaunchInstance(reuse.id, {
                name: launch.name,
                // Stryker disable ConditionalExpression: TerminalService reads an undefined-valued key as absent;
                // the spreads are for types only
                ...(launch.shellPath !== undefined ? { shellPath: launch.shellPath } : {}),
                ...(launch.shellArgs !== undefined ? { shellArgs: launch.shellArgs } : {}),
                ...(launch.cwd !== undefined ? { cwd: launch.cwd } : {}),
                ...(launch.env !== undefined ? { env: launch.env } : {}),
                ...(launch.message !== undefined ? { message: launch.message } : {}),
                // Stryker restore ConditionalExpression
                waitOnExit: launch.waitOnExit,
                clear,
            });
            if (relaunched !== undefined) {
                reuse.data.lastTask = key;
                return [relaunched, reuse.data];
            }
        }
        const instance = this.createTerminal(launch);
        const data: ITerminalData = { lastTask: key, group, kind: launch.kind };
        this.terminals.set(instance.id, data);
        return [instance, data];
    }

    private takeTerminalToReuse(
        key: string,
        panel: IPresentationOptions["panel"],
        group: string | undefined,
        kind: TerminalKind,
    ): IIdleTerminal | undefined {
        if (panel === "dedicated") {
            const own = this.sameTaskTerminals.get(key);
            // Stryker disable next-line CallExpression: equivalent: the entry is overwritten on task exit, and a removed terminal clears it anyway
            this.sameTaskTerminals.delete(key);
            return own?.data.kind === kind ? own : undefined;
        }
        if (panel !== "shared") return undefined;
        // The task's own idle terminal first; otherwise the first idle one of the same group.
        const own = this.idleTaskTerminals.findIndex((idle) => idle.key === key && idle.data.kind === kind);
        const index =
            own !== -1
                ? own
                : this.idleTaskTerminals.findIndex((idle) => idle.data.group === group && idle.data.kind === kind);
        if (index === -1) return undefined;
        const [idle] = this.idleTaskTerminals.splice(index, 1);
        return idle;
    }

    private createTerminal(launch: ILaunch): ITerminalInstance {
        if (launch.kind === "custom") {
            const terminals = this.customTerminals;
            if (terminals === undefined) {
                throw new Error("Tasks with a custom execution need the extension host, which is not running.");
            }
            const id = terminals.createPtyInstance({
                name: launch.name,
                ...(launch.message !== undefined ? { message: launch.message } : {}),
                waitOnExit: launch.waitOnExit,
            });
            const instance = this.terminalService.getInstance(id);
            if (instance === null) throw new Error(`Failed to create terminal for task ${launch.name}`);
            return instance;
        }
        return this.terminalService.createInstance({
            name: launch.name,
            // Stryker disable ConditionalExpression: TerminalService reads an undefined-valued key as absent;
            // the spreads are for types only
            ...(launch.shellPath !== undefined ? { shellPath: launch.shellPath } : {}),
            ...(launch.shellArgs !== undefined ? { shellArgs: launch.shellArgs } : {}),
            ...(launch.cwd !== undefined ? { cwd: launch.cwd } : {}),
            ...(launch.env !== undefined ? { env: launch.env } : {}),
            ...(launch.message !== undefined ? { message: launch.message } : {}),
            // Stryker restore ConditionalExpression
            waitOnExit: launch.waitOnExit,
        });
    }

    /** No `reason`: the process exited by itself; with one, the terminal was closed. The task ends once. */
    private handleExit(terminalId: number, exitCode: number | undefined, reason: TerminalExitReason | undefined): void {
        const entry = [...this.active].find(([, a]) => a.terminalId === terminalId);
        if (entry === undefined) return;
        const [key, active] = entry;
        const { task } = active;
        this.active.delete(key);
        this.fire({ kind: "changed" });
        // A process that exited by itself leaves the terminal idle so it can be reused.
        if (reason === undefined) {
            const idle: IIdleTerminal = { key, id: terminalId, data: active.terminal };
            if (task.command.presentation.panel === "dedicated") this.sameTaskTerminals.set(key, idle);
            if (task.command.presentation.panel === "shared") {
                this.idleTaskTerminals = [idle, ...this.idleTaskTerminals.filter((other) => other.key !== key)];
            }
            // `silent` reveals the terminal only if the task failed.
            if (task.command.presentation.reveal === "silent" && exitCode !== 0) this.show(terminalId, false);
        }
        this.fire({ kind: "processEnded", task, terminalId, exitCode });
        this.fire({ kind: "inactive", task, terminalId });
        this.fire({ kind: "end", task, terminalId });
        if (reason !== undefined) this.fire({ kind: "terminated", task, terminalId, exitReason: reason });
        active.summary.resolve({ exitCode });
    }

    private forgetTerminal(id: number): void {
        const data = this.terminals.get(id);
        if (data === undefined) return;
        this.terminals.delete(id);
        // Stryker disable next-line ConditionalExpression,CallExpression: a stale entry for a removed own terminal is unobservable: relaunching a removed id gives undefined and a new terminal
        if (this.sameTaskTerminals.get(data.lastTask)?.id === id) this.sameTaskTerminals.delete(data.lastTask);
        this.idleTaskTerminals = this.idleTaskTerminals.filter((idle) => idle.id !== id);
    }

    private reveal(task: ITask, terminalId: number): void {
        const { reveal, focus } = task.command.presentation;
        if (focus || reveal === "always") this.show(terminalId, focus);
    }

    private show(terminalId: number, focus: boolean): void {
        this.terminalService.showInstance(terminalId);
        this.views.openView(TERMINAL_VIEW_ID, false, false);
        if (focus) this.terminalService.focusActive();
    }

    private fire(event: ITaskEvent): void {
        this.onDidStateChangeEmitter.fire(event);
    }

    private launchOf(task: ITask, context: ITaskRunContext): ILaunch {
        const { command } = task;
        const resolve = (value: string): string => resolveVariables(value, context.variables);
        const waitOnExit = waitOnExitOf(command.presentation, task.isBackground);
        const name = task.name;
        const resolvedDefinition = resolveDeep(task.definition, resolve);
        if (command.runtime === "custom") {
            return {
                kind: "custom",
                name,
                waitOnExit,
                resolvedDefinition,
                ...(command.presentation.echo ? { message: executingMessage(task._label) } : {}),
            };
        }
        const options = command.options ?? {};
        const cwd = this.cwdOf(task, options.cwd === undefined ? undefined : resolve(options.cwd));
        const env = options.env === undefined ? undefined : resolveRecord(options.env, resolve);
        const commandName = resolveCommandString(command.name ?? "", resolve);
        const args = (command.args ?? []).map((arg) => resolveCommandString(arg, resolve));
        const base = {
            kind: "process" as const,
            name,
            waitOnExit,
            resolvedDefinition,
            cwd,
            // Stryker disable next-line ConditionalExpression: equivalent: env: undefined is dropped on terminal create and relaunch
            ...(env !== undefined ? { env } : {}),
        };
        if (command.runtime === "process") {
            const executable = commandValue(commandName);
            const argValues = args.map(commandValue);
            return {
                ...base,
                shellPath: executable,
                shellArgs: argValues,
                ...(command.presentation.echo
                    ? { message: executingMessage(`${executable} ${argValues.join(" ")}`) }
                    : {}),
            };
        }
        const shell = this.shellOf(options.shell, resolve);
        const commandLine = buildShellCommandLine(
            context.platform,
            shell.executable,
            options.shell,
            commandName,
            // Stryker disable next-line StringLiteral: equivalent: without a command the resolved string is empty, and any source with spaces leaves it as is
            command.name ?? "",
            args,
        );
        return {
            ...base,
            shellPath: shell.executable,
            shellArgs: shellArgsOf(context.platform, shell, commandLine),
            ...(command.presentation.echo ? { message: executingMessage(commandLine) } : {}),
        };
    }

    /** A relative `cwd` is resolved against the task folder; without `cwd`, the folder or the terminal's directory. */
    private cwdOf(task: ITask, cwd: string | undefined): string | undefined {
        const folder = getTaskFolder(task)?.uri.fsPath;
        if (cwd === undefined) return folder;
        return paths.isAbsolute(cwd) || folder === undefined ? cwd : paths.join(folder, cwd);
    }

    private shellOf(
        shell: IShellConfiguration | undefined,
        resolve: (value: string) => string,
    ): { executable: string; args: string[]; specified: boolean } {
        const fallback = this.defaultShell();
        const executable = shell?.executable === undefined ? fallback : resolve(shell.executable);
        // A custom shell gets none of the system shell's args (upstream uses the profile args).
        const args = shell?.args === undefined ? [] : shell.args.map(resolve);
        return { executable, args, specified: shell?.executable !== undefined };
    }
}

function executingMessage(text: string): string {
    return formatMessageForTerminal(`Executing task: ${text}`, { excludeLeadingNewLine: true });
}

function commandValue(value: CommandString): string {
    return typeof value === "string" ? value : value.value;
}

function resolveCommandString(value: CommandString, resolve: (v: string) => string): CommandString {
    return typeof value === "string" ? resolve(value) : { value: resolve(value.value), quoting: value.quoting };
}

function resolveRecord(
    record: Readonly<Record<string, string>>,
    resolve: (v: string) => string,
): Record<string, string> {
    return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, resolve(v)]));
}

function resolveDeep(
    value: Readonly<Record<string, unknown>>,
    resolve: (v: string) => string,
): Record<string, unknown> {
    const walk = (v: unknown): unknown => {
        if (typeof v === "string") return resolve(v);
        if (Array.isArray(v)) return v.map(walk);
        if (typeof v === "object" && v !== null) {
            return Object.fromEntries(Object.entries(v).map(([k, inner]) => [k, walk(inner)]));
        }
        return v;
    };
    const { _key: _ignored, ...definition } = value;
    return walk(definition) as Record<string, unknown>;
}

/** By the shell's OS (upstream uses the process OS, which is the same thing). */
function pathsOf(platform: TaskPlatform): typeof paths.posix {
    return platform === "windows" ? paths.win32 : paths.posix;
}

/** Upstream's `_createShellLaunchConfig`; the command line goes last. */
export function shellArgsOf(
    platform: TaskPlatform,
    shell: { readonly executable: string; readonly args: readonly string[]; readonly specified: boolean },
    commandLine: string,
): string[] {
    const toAdd: string[] = [];
    if (!shell.specified) {
        const basename = pathsOf(platform).basename(shell.executable).toLowerCase();
        if (platform !== "windows") toAdd.push("-c");
        else if (basename === "powershell.exe" || basename === "pwsh.exe") toAdd.push("-Command");
        else if (basename === "bash.exe" || basename === "zsh.exe" || basename === "nu.exe") toAdd.push("-c");
        else if (basename === "wsl.exe") toAdd.push("-e");
        else toAdd.push("/d", "/c");
    }
    return [...addAllArguments(toAdd, shell.args), commandLine];
}

/** Upstream's `_addAllArgument`: don't duplicate an argument already followed by a non-flag tail. */
function addAllArguments(toAdd: readonly string[], configured: readonly string[]): string[] {
    const combined = [...configured];
    for (const element of toAdd) {
        // Upstream also checks "not last": the last one has an empty tail and the answer
        // is the same (`false`), so the check is omitted.
        const shouldAdd = configured.every((arg, index) => {
            if (arg.toLowerCase() === element) {
                return !configured.slice(index + 1).every((rest) => rest.startsWith("-"));
            }
            return true;
        });
        if (shouldAdd) combined.push(element);
    }
    return combined;
}

/** Upstream's `_buildShellCommandLine`; a command line without args goes as is. */
export function buildShellCommandLine(
    platform: TaskPlatform,
    shellExecutable: string,
    shellOptions: IShellConfiguration | undefined,
    command: CommandString,
    originalCommand: CommandString,
    args: readonly CommandString[],
): string {
    const basename = pathsOf(platform).parse(shellExecutable).name.toLowerCase();
    const quotes: IShellQuotingOptions =
        shellOptions?.quoting ?? SHELL_QUOTES.get(basename) ?? OS_SHELL_QUOTES[platform];

    const needsQuotes = (value: string): boolean => {
        // Already fully quoted: leave as is. Upstream's length check (`>= 2`) is
        // omitted: a single quote character makes the loop below return `false`.
        // Stryker disable next-line ConditionalExpression: `q !== undefined` → true is equivalent: find returns the same undefined
        const first = [quotes.strong, quotes.weak].find((q) => q !== undefined && value.startsWith(q));
        if (first !== undefined && value.endsWith(first)) return false;
        let quote: string | undefined;
        // Stryker disable next-line EqualityOperator: equivalent: an extra step past the end (undefined char) changes nothing
        for (let i = 0; i < value.length; i++) {
            const ch = value[i];
            if (ch === quote) quote = undefined;
            else if (quote !== undefined) continue;
            else if (ch === quotes.escape) i++;
            else if (ch === quotes.strong || ch === quotes.weak) quote = ch;
            else if (ch === " ") return true;
        }
        return false;
    };

    const quote = (value: string, kind: ShellQuoting): [string, boolean] => {
        if (kind === "strong" && quotes.strong !== undefined) return [quotes.strong + value + quotes.strong, true];
        if (kind === "weak" && quotes.weak !== undefined) return [quotes.weak + value + quotes.weak, true];
        if (kind === "escape" && quotes.escape !== undefined) {
            if (typeof quotes.escape === "string") return [value.replace(/ /g, `${quotes.escape} `), true];
            const { escapeChar, charsToEscape } = quotes.escape;
            const chars: string[] = [];
            for (const ch of charsToEscape) chars.push(`\\${ch}`);
            return [value.replace(new RegExp(`[${chars.join(",")}]`, "g"), (match) => escapeChar + match), true];
        }
        return [value, false];
    };

    const quoteIfNecessary = (value: CommandString): [string, boolean] => {
        if (typeof value !== "string") return quote(value.value, value.quoting);
        return needsQuotes(value) ? quote(value, "strong") : [value, false];
    };

    // A command without args is the old "whole command line in command" model:
    // keep it as is if substitution did not change it or the source already has spaces.
    if (
        args.length === 0 &&
        typeof command === "string" &&
        // Stryker disable next-line ConditionalExpression: equivalent: the same string not needing quotes also goes as is below, and needsQuotes of an object is false
        (command === originalCommand || (typeof originalCommand === "string" && needsQuotes(originalCommand)))
    ) {
        return command;
    }

    const result: string[] = [];
    const [commandValueQuoted, commandQuoted] = quoteIfNecessary(command);
    result.push(commandValueQuoted);
    let argQuoted = false;
    for (const arg of args) {
        const [value, quoted] = quoteIfNecessary(arg);
        result.push(value);
        argQuoted = argQuoted || quoted;
    }
    let commandLine = result.join(" ");
    if (platform === "windows") {
        if (basename === "cmd" && commandQuoted && argQuoted) commandLine = `"${commandLine}"`;
        else if ((basename === "powershell" || basename === "pwsh") && commandQuoted) commandLine = `& ${commandLine}`;
    }
    return commandLine;
}
