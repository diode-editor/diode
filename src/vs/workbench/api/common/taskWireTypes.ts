// Task wire types (upstream's `api/common/shared/tasks.ts`); the host parses them in
// `services/extensions/node/hostWireParsers.ts`.

/** No `_key` on the wire. */
export interface IWireTaskDefinition {
    readonly type: string;
    readonly [name: string]: unknown;
}

/** `reveal`/`panel` are the numeric values of the API enums. */
export interface IWireTaskPresentation {
    readonly reveal?: number;
    readonly echo?: boolean;
    readonly focus?: boolean;
    readonly panel?: number;
    readonly showReuseMessage?: boolean;
    readonly clear?: boolean;
    readonly group?: string;
    readonly close?: boolean;
}

export interface IWireTaskRunOptions {
    readonly reevaluateOnRerun?: boolean;
}

export interface IWireProcessExecution {
    readonly process: string;
    readonly args: readonly string[];
    readonly options?: { readonly cwd?: string; readonly env?: Readonly<Record<string, string>> };
}

/** `quoting` is the numeric `ShellQuoting` value. */
export interface IWireShellQuotedString {
    readonly value: string;
    readonly quoting: number;
}

export interface IWireShellQuotingOptions {
    readonly escape?: string | { readonly escapeChar: string; readonly charsToEscape: string };
    readonly strong?: string;
    readonly weak?: string;
}

export interface IWireShellExecution {
    readonly commandLine?: string;
    readonly command?: string | IWireShellQuotedString;
    readonly args?: readonly (string | IWireShellQuotedString)[];
    readonly options?: {
        readonly cwd?: string;
        readonly env?: Readonly<Record<string, string>>;
        readonly executable?: string;
        readonly shellArgs?: readonly string[];
        readonly shellQuoting?: IWireShellQuotingOptions;
    };
}

export interface IWireCustomExecution {
    readonly customExecution: "customExecution";
}

export type WireTaskExecutionKind = IWireProcessExecution | IWireShellExecution | IWireCustomExecution;

/** `TaskScope` as a number, or a workspace folder path. */
export type WireTaskScope = number | { readonly folder: string };

export interface IWireTaskSource {
    readonly label: string;
    readonly extensionId: string;
    readonly scope: WireTaskScope;
}

/** `id` is the core's `_id` when the task came from the core. */
export interface IWireTask {
    readonly id?: string;
    readonly name: string;
    readonly execution: WireTaskExecutionKind | undefined;
    readonly definition: IWireTaskDefinition;
    readonly isBackground: boolean;
    readonly source: IWireTaskSource;
    readonly group?: { readonly id: string; readonly isDefault?: boolean };
    readonly detail?: string;
    readonly presentationOptions?: IWireTaskPresentation;
    readonly problemMatchers: readonly string[];
    readonly hasDefinedMatchers: boolean;
    readonly runOptions?: IWireTaskRunOptions;
}

/** Execution id = the core's task id. */
export interface IWireTaskExecution {
    readonly id: string;
    readonly task: IWireTask;
}

export interface IWireTaskProviderRegistration {
    readonly handle: number;
    readonly type: string;
    readonly extensionId: string;
}

export interface IWireTaskProviderHandle {
    readonly handle: number;
}

export interface IWireTaskFilter {
    readonly type?: string;
}

/** A core task by id (from `fetchTasks`, unmodified) or the full description. */
export type WireTaskExecuteRequest = { readonly id: string } | { readonly task: IWireTask };

export interface IWireTaskExecutionId {
    readonly id: string;
}

export interface IWireTaskStarted {
    readonly execution: IWireTaskExecution;
    readonly terminalId: number;
    readonly resolvedDefinition: IWireTaskDefinition;
}

export interface IWireTaskProcessStarted {
    readonly id: string;
    readonly processId: number;
}

/** No `exitCode` — the process was closed and has no code. */
export interface IWireTaskProcessEnded {
    readonly id: string;
    readonly exitCode?: number;
}

export interface IWireTaskEnded {
    readonly execution: IWireTaskExecution;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null;
}

/** The core serializer (`taskToWire`) guarantees the shape — the check is shallow. */
export function parseWireTask(value: unknown): IWireTask | null {
    if (!isRecord(value) || typeof value.name !== "string") return null;
    if (!isRecord(value.definition) || typeof value.definition.type !== "string") return null;
    if (!isRecord(value.source)) return null;
    return value as unknown as IWireTask;
}

export function parseWireTaskExecution(value: unknown): IWireTaskExecution | null {
    if (!isRecord(value) || typeof value.id !== "string") return null;
    const task = parseWireTask(value.task);
    return task === null ? null : { id: value.id, task };
}

export function parseWireTaskStarted(value: unknown): IWireTaskStarted | null {
    if (!isRecord(value) || typeof value.terminalId !== "number") return null;
    const execution = parseWireTaskExecution(value.execution);
    if (execution === null) return null;
    const resolved = isRecord(value.resolvedDefinition)
        ? (value.resolvedDefinition as IWireTaskDefinition)
        : execution.task.definition;
    return { execution, terminalId: value.terminalId, resolvedDefinition: resolved };
}

export function parseWireTaskProcessStarted(value: unknown): IWireTaskProcessStarted | null {
    if (!isRecord(value) || typeof value.id !== "string" || typeof value.processId !== "number") return null;
    return { id: value.id, processId: value.processId };
}

export function parseWireTaskProcessEnded(value: unknown): IWireTaskProcessEnded | null {
    if (!isRecord(value) || typeof value.id !== "string") return null;
    return { id: value.id, ...(typeof value.exitCode === "number" ? { exitCode: value.exitCode } : {}) };
}

export function parseWireTaskEnded(value: unknown): IWireTaskEnded | null {
    if (!isRecord(value)) return null;
    const execution = parseWireTaskExecution(value.execution);
    return execution === null ? null : { execution };
}

export function parseWireTasks(value: unknown): IWireTask[] {
    if (!Array.isArray(value)) return [];
    return (value as readonly unknown[]).map(parseWireTask).filter((task): task is IWireTask => task !== null);
}
