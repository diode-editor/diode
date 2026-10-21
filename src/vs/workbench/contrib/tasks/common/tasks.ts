// Problem matchers are stored but affect nothing (see docs/TODO/Tasks.md).

import type { IWorkspaceFolder } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import type { IKeyedTaskIdentifier } from "../../../api/common/taskIdentity.ts";

export type RuntimeType = "shell" | "process" | "custom";

export type ShellQuoting = "escape" | "strong" | "weak";

export interface IQuotedString {
    readonly value: string;
    readonly quoting: ShellQuoting;
}

export type CommandString = string | IQuotedString;

export interface IShellQuotingOptions {
    readonly escape?: string | { readonly escapeChar: string; readonly charsToEscape: string };
    readonly strong?: string;
    readonly weak?: string;
}

export interface IShellConfiguration {
    readonly executable?: string;
    readonly args?: readonly string[];
    readonly quoting?: IShellQuotingOptions;
}

/** `env` goes on top of the inherited one. */
export interface ICommandOptions {
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string>>;
    readonly shell?: IShellConfiguration;
}

export type RevealKind = "always" | "silent" | "never";

export type PanelKind = "shared" | "dedicated" | "new";

export interface IPresentationOptions {
    readonly echo: boolean;
    readonly reveal: RevealKind;
    readonly focus: boolean;
    readonly panel: PanelKind;
    readonly showReuseMessage: boolean;
    readonly clear: boolean;
    readonly group?: string;
    readonly close?: boolean;
}

/** Upstream's `PresentationOptions.defaults`. */
export const DEFAULT_PRESENTATION: IPresentationOptions = {
    echo: true,
    reveal: "always",
    focus: false,
    panel: "shared",
    showReuseMessage: true,
    clear: false,
};

export type InstancePolicy = "terminateNewest" | "terminateOldest" | "prompt" | "warn" | "silent";

/** Task `runOptions` (`IRunOptions`); `runOn` is not supported (docs/TODO/Tasks.md). */
export interface IRunOptions {
    readonly reevaluateOnRerun: boolean;
    readonly instanceLimit: number;
    readonly instancePolicy: InstancePolicy;
}

/** Upstream's `RunOptions.defaults`. */
export const DEFAULT_RUN_OPTIONS: IRunOptions = { reevaluateOnRerun: true, instanceLimit: 1, instancePolicy: "prompt" };

/** `custom` has no command. */
export interface ICommandConfiguration {
    readonly runtime: RuntimeType;
    readonly name?: CommandString;
    readonly args?: readonly CommandString[];
    readonly options?: ICommandOptions;
    readonly presentation: IPresentationOptions;
}

export type TaskScopeKind = "global" | "workspace" | "folder";

export type TaskSource =
    | {
          readonly kind: "workspace";
          readonly label: "Workspace";
          readonly folder: IWorkspaceFolder;
      }
    | {
          readonly kind: "extension";
          /** The task label is "{label}: {name}". */
          readonly label: string;
          readonly extensionId: string;
          readonly scope: TaskScopeKind;
          readonly folder: IWorkspaceFolder | undefined;
      };

export interface ITaskGroup {
    readonly id: string;
    readonly isDefault?: boolean;
}

/**
 * Upstream's `CustomTask`/`ContributedTask` in one shape. A reread tasks.json
 * gives new objects; the same task is recognized by {@link getMapKey}.
 */
export interface ITask {
    /** Internal id: `${extension}.${_key}` for a provider task, `$core.${label}` for tasks.json. */
    readonly _id: string;
    /** Label in pickers and the terminal name: "{source}: {name}" for a provider task. */
    readonly _label: string;
    readonly name: string;
    readonly type: string;
    readonly source: TaskSource;
    readonly definition: IKeyedTaskIdentifier;
    readonly command: ICommandConfiguration;
    readonly isBackground: boolean;
    readonly detail?: string;
    readonly hide?: boolean;
    /** The group is stored and sent to extensions, but there are no build/test groups yet, so runs ignore it. */
    readonly group?: ITaskGroup;
    readonly problemMatchers: readonly string[];
    readonly hasDefinedMatchers: boolean;
    readonly runOptions: IRunOptions;
    /** Entry index in tasks.json `tasks`; absent for a provider task without customization. */
    readonly configIndex?: number;
}

/** Values set here override the provider's fields (upstream's `createCustomTask`). */
export interface ITaskCustomization {
    readonly label?: string;
    readonly detail?: string;
    readonly hide?: boolean;
    readonly group?: ITaskGroup;
    readonly isBackground?: boolean;
    readonly problemMatchers?: readonly string[];
    readonly presentation?: Partial<IPresentationOptions>;
    readonly options?: ICommandOptions;
    readonly runOptions: IRunOptions;
}

/** Not a task yet: it is looked up among provider tasks by definition key. */
export interface IConfiguringTask {
    /** `${extension}.${_key}`: the same id as the provider task this entry customizes. */
    readonly _id: string;
    /** The entry's `label` or "{type}: {first required property}". */
    readonly _label: string;
    readonly type: string;
    readonly configures: IKeyedTaskIdentifier;
    readonly folder: IWorkspaceFolder;
    readonly configIndex: number;
    readonly customization: ITaskCustomization;
    /** As in the file, for the "provider did not contribute such a task" message. */
    readonly element: Readonly<Record<string, unknown>>;
}

export function isConfiguredTask(task: ITask): boolean {
    return task.configIndex !== undefined;
}

export function getTaskFolder(task: ITask): IWorkspaceFolder | undefined {
    return task.source.folder;
}

/** Used to find the running copy and the terminal to reuse. */
export function getMapKey(task: ITask): string {
    const folder = task.source.folder?.uri.toString();
    if (task.source.kind === "workspace") return `${String(folder)}|${task._id}`;
    return folder === undefined ? `${task.source.scope}|${task._id}` : `${task.source.scope}|${folder}|${task._id}`;
}

/** A string is a label (for a tasks.json task it is the `label`); a definition matches by `_key`. */
export function taskMatches(task: ITask, key: string | IKeyedTaskIdentifier): boolean {
    if (typeof key === "string") return key === task._label;
    return task.definition._key === key._key;
}

export function compareTasks(a: ITask, b: ITask): number {
    return a._label.localeCompare(b._label);
}
