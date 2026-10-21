import type { IWorkspaceFolder } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import {
    contributedTaskId,
    createTaskIdentifier,
    type IKeyedTaskIdentifier,
    type ITaskDefinitionSchema,
} from "../../../api/common/taskIdentity.ts";
import type {
    IWireShellExecution,
    IWireShellQuotedString,
    IWireTask,
    IWireTaskDefinition,
    IWireTaskPresentation,
    WireTaskExecutionKind,
    WireTaskScope,
} from "../../../api/common/taskWireTypes.ts";

import {
    type CommandString,
    DEFAULT_PRESENTATION,
    DEFAULT_RUN_OPTIONS,
    type ICommandConfiguration,
    type IPresentationOptions,
    type ITask,
    type PanelKind,
    type RevealKind,
    type ShellQuoting,
    type TaskScopeKind,
    type TaskSource,
} from "./tasks.ts";

/** API `TaskScope` values. */
const SCOPE_GLOBAL = 1;
const SCOPE_WORKSPACE = 2;

const REVEAL_KINDS: readonly RevealKind[] = ["always", "silent", "never"];
const PANEL_KINDS: readonly PanelKind[] = ["shared", "dedicated", "new"];
const QUOTINGS: readonly ShellQuoting[] = ["escape", "strong", "weak"];

export const CORE_TASK_EXTENSION_ID = "$core";

export interface ITaskFromWireContext {
    readonly folders: readonly IWorkspaceFolder[];
    readonly schemaOf: (type: string) => ITaskDefinitionSchema | undefined;
    readonly report: (message: string) => void;
}

function quotedFromWire(value: string | IWireShellQuotedString): CommandString {
    return typeof value === "string" ? value : { value: value.value, quoting: QUOTINGS[value.quoting - 1] ?? "strong" };
}

function quotedToWire(value: CommandString): string | IWireShellQuotedString {
    return typeof value === "string" ? value : { value: value.value, quoting: QUOTINGS.indexOf(value.quoting) + 1 };
}

function presentationFromWire(wire: IWireTaskPresentation | undefined): IPresentationOptions {
    if (wire === undefined) return DEFAULT_PRESENTATION;
    // Stryker disable next-line ConditionalExpression: equivalent: a NaN index also gives undefined; the check is for types
    const reveal = wire.reveal === undefined ? undefined : REVEAL_KINDS[wire.reveal - 1];
    // Stryker disable next-line ConditionalExpression: equivalent: see reveal
    const panel = wire.panel === undefined ? undefined : PANEL_KINDS[wire.panel - 1];
    return {
        ...DEFAULT_PRESENTATION,
        ...(wire.echo !== undefined ? { echo: wire.echo } : {}),
        ...(reveal !== undefined ? { reveal } : {}),
        ...(wire.focus !== undefined ? { focus: wire.focus } : {}),
        ...(panel !== undefined ? { panel } : {}),
        ...(wire.showReuseMessage !== undefined ? { showReuseMessage: wire.showReuseMessage } : {}),
        ...(wire.clear !== undefined ? { clear: wire.clear } : {}),
        ...(wire.group !== undefined ? { group: wire.group } : {}),
        ...(wire.close !== undefined ? { close: wire.close } : {}),
    };
}

function presentationToWire(presentation: IPresentationOptions): IWireTaskPresentation {
    return {
        echo: presentation.echo,
        reveal: REVEAL_KINDS.indexOf(presentation.reveal) + 1,
        focus: presentation.focus,
        panel: PANEL_KINDS.indexOf(presentation.panel) + 1,
        showReuseMessage: presentation.showReuseMessage,
        clear: presentation.clear,
        ...(presentation.group !== undefined ? { group: presentation.group } : {}),
        ...(presentation.close !== undefined ? { close: presentation.close } : {}),
    };
}

/**
 * A process without `cwd` gets `${workspaceFolder}`, a shell does not; `options.shell` only with an executable,
 * as upstream.
 */
function commandFromWire(execution: WireTaskExecutionKind, presentation: IPresentationOptions): ICommandConfiguration {
    if ("customExecution" in execution) return { runtime: "custom", presentation };
    const env = execution.options?.env;
    if ("process" in execution) {
        return {
            runtime: "process",
            name: execution.process,
            args: [...execution.args],
            options: { cwd: execution.options?.cwd ?? "${workspaceFolder}", ...(env !== undefined ? { env } : {}) },
            presentation,
        };
    }
    const options = execution.options;
    const shell =
        options?.executable === undefined
            ? undefined
            : {
                  executable: options.executable,
                  ...(options.shellArgs !== undefined ? { args: options.shellArgs } : {}),
                  ...(options.shellQuoting !== undefined ? { quoting: options.shellQuoting } : {}),
              };
    return {
        runtime: "shell",
        name: execution.commandLine ?? quotedFromWire(execution.command ?? ""),
        args: (execution.args ?? []).map(quotedFromWire),
        ...(options === undefined
            ? {}
            : {
                  options: {
                      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
                      ...(env !== undefined ? { env } : {}),
                      ...(shell !== undefined ? { shell } : {}),
                  },
              }),
        presentation,
    };
}

/** Workspace or no scope means the first folder (global without folders). */
function sourceFromWire(wire: IWireTask, folders: readonly IWorkspaceFolder[]): TaskSource {
    const { label, extensionId } = wire.source;
    const scope = wire.source.scope;
    if (typeof scope === "number") {
        const folder = scope === SCOPE_GLOBAL ? undefined : folders.at(0);
        return { kind: "extension", label, extensionId, scope: folder === undefined ? "global" : "folder", folder };
    }
    const folder = folders.find((candidate) => candidate.uri.fsPath === scope.folder);
    return { kind: "extension", label, extensionId, scope: "folder", folder };
}

/**
 * A `CustomExecution` task from the core keeps its id; a definition failing the schema becomes upstream's
 * `$executeOnly` with a random key.
 */
export function taskFromWire(wire: IWireTask, context: ITaskFromWireContext): ITask | undefined {
    if (wire.execution === undefined) return undefined;
    const presentation = presentationFromWire(wire.presentationOptions);
    const command = commandFromWire(wire.execution, presentation);
    const definition: IKeyedTaskIdentifier = createTaskIdentifier(
        wire.definition,
        context.schemaOf(wire.definition.type),
        context.report,
    ) ?? { type: "$executeOnly", _key: globalThis.crypto.randomUUID() };
    const source = sourceFromWire(wire, context.folders);
    const id =
        command.runtime === "custom" && wire.id !== undefined
            ? wire.id
            : contributedTaskId(wire.source.extensionId, definition);
    return {
        _id: id,
        _label: `${source.label}: ${wire.name}`,
        name: wire.name,
        type: definition.type,
        source,
        definition,
        command,
        isBackground: wire.isBackground,
        ...(wire.detail !== undefined ? { detail: wire.detail } : {}),
        ...(wire.group !== undefined ? { group: wire.group } : {}),
        problemMatchers: [...wire.problemMatchers],
        hasDefinedMatchers: wire.hasDefinedMatchers,
        runOptions: { ...DEFAULT_RUN_OPTIONS, ...wire.runOptions },
    };
}

function scopeToWire(task: ITask): WireTaskScope {
    const folder = task.source.folder;
    if (folder !== undefined) return { folder: folder.uri.fsPath };
    const scope: TaskScopeKind = task.source.kind === "workspace" ? "global" : task.source.scope;
    return scope === "global" ? SCOPE_GLOBAL : SCOPE_WORKSPACE;
}

function executionToWire(command: ICommandConfiguration): WireTaskExecutionKind {
    if (command.runtime === "custom") return { customExecution: "customExecution" };
    const options = command.options;
    const common = {
        ...(options?.cwd !== undefined ? { cwd: options.cwd } : {}),
        ...(options?.env !== undefined ? { env: options.env } : {}),
    };
    const name = command.name ?? "";
    const args = command.args ?? [];
    if (command.runtime === "process") {
        return {
            process: typeof name === "string" ? name : name.value,
            args: args.map((arg) => (typeof arg === "string" ? arg : arg.value)),
            ...(options !== undefined ? { options: common } : {}),
        };
    }
    const shell = options?.shell;
    const shellOptions = {
        ...common,
        ...(shell?.executable !== undefined ? { executable: shell.executable } : {}),
        ...(shell?.args !== undefined ? { shellArgs: shell.args } : {}),
        ...(shell?.quoting !== undefined ? { shellQuoting: shell.quoting } : {}),
    };
    // A command without args is a command line (`ShellExecutionDTO.from`).
    const wire: IWireShellExecution =
        typeof name === "string" && args.length === 0
            ? { commandLine: name }
            : { command: quotedToWire(name), args: args.map(quotedToWire) };
    return { ...wire, ...(options !== undefined ? { options: shellOptions } : {}) };
}

export function taskToWire(task: ITask): IWireTask {
    const { _key: _ignored, ...definition } = task.definition;
    return {
        id: task._id,
        name: task.name,
        execution: executionToWire(task.command),
        definition: definition as IWireTaskDefinition,
        isBackground: task.isBackground,
        source: {
            label: task.source.label,
            extensionId: task.source.kind === "workspace" ? CORE_TASK_EXTENSION_ID : task.source.extensionId,
            scope: scopeToWire(task),
        },
        ...(task.group !== undefined ? { group: task.group } : {}),
        ...(task.detail !== undefined ? { detail: task.detail } : {}),
        presentationOptions: presentationToWire(task.command.presentation),
        problemMatchers: task.problemMatchers,
        hasDefinedMatchers: task.hasDefinedMatchers,
        runOptions: { reevaluateOnRerun: task.runOptions.reevaluateOnRerun },
    };
}
