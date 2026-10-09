// Модель задач (`contrib/tasks/common/tasks.ts` эталона) в объёме первой
// итерации: задача из tasks.json (`CustomTask`) и задача провайдера
// расширения (`ContributedTask`) — одна форма с источником; исполнение —
// шелл, процесс или pty расширения (`CustomExecution`). Problem matchers
// хранятся, но ни на что не влияют (см. docs/TODO/Tasks.md).

import type { IWorkspaceFolder } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import type { IKeyedTaskIdentifier } from "../../../api/common/taskIdentity.ts";

/** Как исполняется задача (`RuntimeType` эталона). */
export type RuntimeType = "shell" | "process" | "custom";

/** Как экранировать аргумент шелла (`ShellQuoting` эталона). */
export type ShellQuoting = "escape" | "strong" | "weak";

/** Аргумент с правилом экранирования (`{ value, quoting }`). */
export interface IQuotedString {
    readonly value: string;
    readonly quoting: ShellQuoting;
}

/** Команда или аргумент: строка (экранируется по надобности) или строка с правилом. */
export type CommandString = string | IQuotedString;

/** Экранирование шелла (`IShellQuotingOptions` эталона). */
export interface IShellQuotingOptions {
    readonly escape?: string | { readonly escapeChar: string; readonly charsToEscape: string };
    readonly strong?: string;
    readonly weak?: string;
}

/** Шелл задачи (`options.shell`). */
export interface IShellConfiguration {
    readonly executable?: string;
    readonly args?: readonly string[];
    readonly quoting?: IShellQuotingOptions;
}

/** `options` задачи: рабочий каталог, окружение поверх унаследованного, шелл. */
export interface ICommandOptions {
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string>>;
    readonly shell?: IShellConfiguration;
}

/** Когда показывать терминал задачи (`RevealKind`). */
export type RevealKind = "always" | "silent" | "never";

/** Чей терминал занимает задача (`PanelKind`). */
export type PanelKind = "shared" | "dedicated" | "new";

/** `presentation` задачи (`IPresentationOptions` эталона). */
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

/** Дефолты `presentation` (`PresentationOptions.defaults` эталона). */
export const DEFAULT_PRESENTATION: IPresentationOptions = {
    echo: true,
    reveal: "always",
    focus: false,
    panel: "shared",
    showReuseMessage: true,
    clear: false,
};

/** Что делать при запуске уже бегущей задачи (`InstancePolicy`). */
export type InstancePolicy = "terminateNewest" | "terminateOldest" | "prompt" | "warn" | "silent";

/** `runOptions` задачи (`IRunOptions`); `runOn` не поддержан (docs/TODO/Tasks.md). */
export interface IRunOptions {
    readonly reevaluateOnRerun: boolean;
    readonly instanceLimit: number;
    readonly instancePolicy: InstancePolicy;
}

/** Дефолты `runOptions` (`RunOptions.defaults` эталона). */
export const DEFAULT_RUN_OPTIONS: IRunOptions = { reevaluateOnRerun: true, instanceLimit: 1, instancePolicy: "prompt" };

/** Что и как запускать (`ICommandConfiguration`). У `custom` команды нет. */
export interface ICommandConfiguration {
    readonly runtime: RuntimeType;
    readonly name?: CommandString;
    readonly args?: readonly CommandString[];
    readonly options?: ICommandOptions;
    readonly presentation: IPresentationOptions;
}

/** Область задачи (`TaskScope`): глобальная, воркспейс, папка. */
export type TaskScopeKind = "global" | "workspace" | "folder";

/** Откуда задача: tasks.json воркспейса или провайдер расширения. */
export type TaskSource =
    | {
          readonly kind: "workspace";
          readonly label: "Workspace";
          readonly folder: IWorkspaceFolder;
      }
    | {
          readonly kind: "extension";
          /** `Task.source` расширения — подпись задачи «{label}: {name}». */
          readonly label: string;
          readonly extensionId: string;
          readonly scope: TaskScopeKind;
          readonly folder: IWorkspaceFolder | undefined;
      };

/** Группа задачи (`TaskGroup`): `build`, `test`, … и признак группы по умолчанию. */
export interface ITaskGroup {
    readonly id: string;
    readonly isDefault?: boolean;
}

/**
 * Задача ядра (`CustomTask`/`ContributedTask` эталона одной формой). Значение:
 * перечитанный tasks.json и новый ответ провайдера дают новые объекты, а одну и
 * ту же задачу узнают по {@link getMapKey}.
 */
export interface ITask {
    /** Внутренний id: у задачи провайдера — `${расширение}.${_key}`, у tasks.json — `$core.${label}`. */
    readonly _id: string;
    /** Подпись в пикерах и имя терминала: у задачи провайдера — «{source}: {name}». */
    readonly _label: string;
    /** `Task.name` / `label` из tasks.json. */
    readonly name: string;
    /** Тип определения: `shell`, `process` или тип провайдера. */
    readonly type: string;
    readonly source: TaskSource;
    readonly definition: IKeyedTaskIdentifier;
    readonly command: ICommandConfiguration;
    readonly isBackground: boolean;
    readonly detail?: string;
    readonly hide?: boolean;
    /** Группа хранится и уезжает расширениям, но групп build/test пока нет — на запуск не влияет. */
    readonly group?: ITaskGroup;
    /** Матчеры хранятся, но не исполняются (problem matchers не поддержаны). */
    readonly problemMatchers: readonly string[];
    readonly hasDefinedMatchers: boolean;
    readonly runOptions: IRunOptions;
}

/** Папка задачи — её рабочий каталог и `${workspaceFolder}`. */
export function getTaskFolder(task: ITask): IWorkspaceFolder | undefined {
    return task.source.folder;
}

/**
 * Ключ «та же задача» (`getMapKey` эталона): по нему ищутся бегущая копия и
 * терминал, который задача может переиспользовать.
 */
export function getMapKey(task: ITask): string {
    const folder = task.source.folder?.uri.toString();
    if (task.source.kind === "workspace") return `${String(folder)}|${task._id}`;
    return folder === undefined ? `${task.source.scope}|${task._id}` : `${task.source.scope}|${folder}|${task._id}`;
}

/**
 * Подходит ли задача под аргумент команды (`matches` эталона): строка —
 * подпись (у задачи tasks.json она же `label`), определение — по `_key`.
 */
export function taskMatches(task: ITask, key: string | IKeyedTaskIdentifier): boolean {
    if (typeof key === "string") return key === task._label;
    return task.definition._key === key._key;
}

/** Порядок задач в пикерах (`TaskSorter` эталона при одной папке): по подписи. */
export function compareTasks(a: ITask, b: ITask): number {
    return a._label.localeCompare(b._label);
}
