// Problem matchers хранятся, но ни на что не влияют (см. docs/TODO/Tasks.md).

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

/** `env` — поверх унаследованного. */
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

/** `PresentationOptions.defaults` эталона. */
export const DEFAULT_PRESENTATION: IPresentationOptions = {
    echo: true,
    reveal: "always",
    focus: false,
    panel: "shared",
    showReuseMessage: true,
    clear: false,
};

export type InstancePolicy = "terminateNewest" | "terminateOldest" | "prompt" | "warn" | "silent";

/** `runOptions` задачи (`IRunOptions`); `runOn` не поддержан (docs/TODO/Tasks.md). */
export interface IRunOptions {
    readonly reevaluateOnRerun: boolean;
    readonly instanceLimit: number;
    readonly instancePolicy: InstancePolicy;
}

/** `RunOptions.defaults` эталона. */
export const DEFAULT_RUN_OPTIONS: IRunOptions = { reevaluateOnRerun: true, instanceLimit: 1, instancePolicy: "prompt" };

/** У `custom` команды нет. */
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
          /** Подпись задачи — «{label}: {name}». */
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
 * `CustomTask`/`ContributedTask` эталона одной формой. Перечитанный tasks.json
 * даёт новые объекты — одну и ту же задачу узнают по {@link getMapKey}.
 */
export interface ITask {
    /** Внутренний id: у задачи провайдера — `${расширение}.${_key}`, у tasks.json — `$core.${label}`. */
    readonly _id: string;
    /** Подпись в пикерах и имя терминала: у задачи провайдера — «{source}: {name}». */
    readonly _label: string;
    readonly name: string;
    readonly type: string;
    readonly source: TaskSource;
    readonly definition: IKeyedTaskIdentifier;
    readonly command: ICommandConfiguration;
    readonly isBackground: boolean;
    readonly detail?: string;
    readonly hide?: boolean;
    /** Группа хранится и уезжает расширениям, но групп build/test пока нет — на запуск не влияет. */
    readonly group?: ITaskGroup;
    readonly problemMatchers: readonly string[];
    readonly hasDefinedMatchers: boolean;
    readonly runOptions: IRunOptions;
    /** Индекс записи в `tasks` tasks.json; у задачи провайдера без кастомизации — нет. */
    readonly configIndex?: number;
}

/** Заданное здесь — поверх полей провайдера (`createCustomTask` эталона). */
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

/** Ещё не задача — её находят среди задач провайдера по ключу определения. */
export interface IConfiguringTask {
    /** `${расширение}.${_key}` — тот же id, что у задачи провайдера, которую запись кастомизирует. */
    readonly _id: string;
    /** `label` записи или «{тип}: {первое обязательное свойство}». */
    readonly _label: string;
    readonly type: string;
    readonly configures: IKeyedTaskIdentifier;
    readonly folder: IWorkspaceFolder;
    readonly configIndex: number;
    readonly customization: ITaskCustomization;
    /** Как в файле — для сообщения «провайдер такую задачу не дал». */
    readonly element: Readonly<Record<string, unknown>>;
}

export function isConfiguredTask(task: ITask): boolean {
    return task.configIndex !== undefined;
}

export function getTaskFolder(task: ITask): IWorkspaceFolder | undefined {
    return task.source.folder;
}

/** По нему ищутся бегущая копия и терминал для переиспользования. */
export function getMapKey(task: ITask): string {
    const folder = task.source.folder?.uri.toString();
    if (task.source.kind === "workspace") return `${String(folder)}|${task._id}`;
    return folder === undefined ? `${task.source.scope}|${task._id}` : `${task.source.scope}|${folder}|${task._id}`;
}

/** Строка — подпись (у задачи tasks.json она же `label`), определение — по `_key`. */
export function taskMatches(task: ITask, key: string | IKeyedTaskIdentifier): boolean {
    if (typeof key === "string") return key === task._label;
    return task.definition._key === key._key;
}

export function compareTasks(a: ITask, b: ITask): number {
    return a._label.localeCompare(b._label);
}
