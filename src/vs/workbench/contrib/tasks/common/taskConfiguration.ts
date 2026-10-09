// Разбор `.vscode/tasks.json` (`taskConfiguration.ts` эталона) — подмножество
// схемы 2.0.0 первой итерации: задачи `shell`/`process` с `command`/`args`/
// `options`/`presentation`/`runOptions`, секции платформы
// (`linux`/`osx`/`windows`), глобальные `options` и `presentation`.
// Неподдержанное не роняет задачу, а называется предупреждением в лог `tasks`;
// запись с типом провайдера (кастомизация задачи расширения — нужен
// `resolveTask`) пропускается с предупреждением (docs/TODO/Tasks.md).

import { parse, type ParseError, printParseErrorCode } from "jsonc-parser";

import type { IWorkspaceFolder } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";

import {
    type CommandString,
    DEFAULT_PRESENTATION,
    DEFAULT_RUN_OPTIONS,
    type ICommandOptions,
    type InstancePolicy,
    type IPresentationOptions,
    type IRunOptions,
    type IShellConfiguration,
    type IShellQuotingOptions,
    type ITask,
    type ITaskGroup,
    type PanelKind,
    type RevealKind,
    type RuntimeType,
    type ShellQuoting,
} from "./tasks.ts";

/** Платформа для секций `windows`/`osx`/`linux`. */
export type TaskPlatform = "windows" | "osx" | "linux";

/** Платформа процесса в терминах tasks.json. */
export function currentTaskPlatform(platform: NodeJS.Platform = process.platform): TaskPlatform {
    if (platform === "win32") return "windows";
    if (platform === "darwin") return "osx";
    return "linux";
}

/** Итог разбора: задачи и предупреждения для лога `tasks` (тексты эталона, где он их даёт). */
export interface ITaskConfigurationParseResult {
    readonly tasks: readonly ITask[];
    readonly problems: readonly string[];
}

/** Префикс id задачи tasks.json (`$core` — `extensionId` таких задач у эталона в DTO). */
export const WORKSPACE_TASK_ID_PREFIX = "$core.";

type Json = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is Json {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
    return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** `ShellQuoting.from` эталона: неизвестное — `strong`. */
function quotingFrom(value: unknown): ShellQuoting {
    return value === "escape" || value === "weak" ? value : "strong";
}

/** `ShellString.from`: строка, массив строк (через пробел) или `{ value, quoting }`. */
function commandStringFrom(value: unknown): CommandString | undefined {
    if (typeof value === "string") return value;
    if (isStringArray(value)) return value.join(" ");
    if (!isObject(value)) return undefined;
    const raw = value.value;
    const text = typeof raw === "string" ? raw : isStringArray(raw) ? raw.join(" ") : undefined;
    if (text === undefined || text === "") return undefined;
    return { value: text, quoting: quotingFrom(value.quoting) };
}

function quotingOptionsFrom(value: unknown): IShellQuotingOptions | undefined {
    if (!isObject(value)) return undefined;
    const escape = value.escape;
    return {
        ...(typeof escape === "string" ? { escape } : {}),
        ...(isObject(escape) && typeof escape.escapeChar === "string" && typeof escape.charsToEscape === "string"
            ? { escape: { escapeChar: escape.escapeChar, charsToEscape: escape.charsToEscape } }
            : {}),
        ...(typeof value.strong === "string" ? { strong: value.strong } : {}),
        ...(typeof value.weak === "string" ? { weak: value.weak } : {}),
    };
}

function shellFrom(value: unknown): IShellConfiguration | undefined {
    if (!isObject(value)) return undefined;
    const quoting = quotingOptionsFrom(value.quoting);
    return {
        ...(typeof value.executable === "string" ? { executable: value.executable } : {}),
        ...(isStringArray(value.args) ? { args: value.args } : {}),
        ...(quoting !== undefined ? { quoting } : {}),
    };
}

function envFrom(value: unknown): Record<string, string> | undefined {
    if (!isObject(value)) return undefined;
    const env: Record<string, string> = {};
    for (const [key, v] of Object.entries(value)) if (typeof v === "string") env[key] = v;
    return env;
}

/** `CommandOptions.from`: нестроковый `cwd` — предупреждение эталона. */
function optionsFrom(value: unknown, problems: string[]): ICommandOptions | undefined {
    if (!isObject(value)) return undefined;
    if (value.cwd !== undefined && typeof value.cwd !== "string") {
        problems.push(`Warning: options.cwd must be of type string. Ignoring value ${JSON.stringify(value.cwd)}`);
    }
    const env = envFrom(value.env);
    const shell = shellFrom(value.shell);
    // Пустые env/shell отсеет слияние с опциями по умолчанию (`mergeOptions`).
    return { ...(typeof value.cwd === "string" ? { cwd: value.cwd } : {}), env, shell };
}

/**
 * Слить опции (`CommandOptions.assignProperties`): `cwd` и шелл источника
 * перекрывают цель, окружения складываются (источник поверх).
 */
function mergeOptions(
    target: ICommandOptions | undefined,
    source: ICommandOptions | undefined,
): ICommandOptions | undefined {
    if (source === undefined) return target;
    if (target === undefined) return source;
    const env = target.env === undefined ? source.env : { ...target.env, ...source.env };
    const shell = source.shell === undefined ? target.shell : { ...target.shell, ...source.shell };
    return {
        // Stryker disable next-line ConditionalExpression: эквивалентный — итоговые опции сливаются с `cwd` по умолчанию, пустой ключ не доживает
        ...((source.cwd ?? target.cwd) !== undefined ? { cwd: source.cwd ?? target.cwd } : {}),
        ...(env !== undefined ? { env } : {}),
        ...(shell !== undefined ? { shell } : {}),
    };
}

/** `RevealKind.fromString`: неизвестное — `always`. */
function revealFrom(value: string): RevealKind {
    const lower = value.toLowerCase();
    return lower === "silent" || lower === "never" ? lower : "always";
}

/** `PanelKind.fromString`: неизвестное — `shared`. */
function panelFrom(value: string): PanelKind {
    const lower = value.toLowerCase();
    return lower === "dedicated" || lower === "new" ? lower : "shared";
}

/** Заданные поля `presentation` (`PresentationOptions.from`); пустое — `undefined`. */
function presentationFrom(value: unknown): Partial<IPresentationOptions> | undefined {
    if (!isObject(value)) return undefined;
    return {
        ...(typeof value.echo === "boolean" ? { echo: value.echo } : {}),
        ...(typeof value.reveal === "string" ? { reveal: revealFrom(value.reveal) } : {}),
        ...(typeof value.focus === "boolean" ? { focus: value.focus } : {}),
        ...(typeof value.panel === "string" ? { panel: panelFrom(value.panel) } : {}),
        ...(typeof value.showReuseMessage === "boolean" ? { showReuseMessage: value.showReuseMessage } : {}),
        ...(typeof value.clear === "boolean" ? { clear: value.clear } : {}),
        ...(typeof value.group === "string" ? { group: value.group } : {}),
        ...(typeof value.close === "boolean" ? { close: value.close } : {}),
    };
}

const INSTANCE_POLICIES: ReadonlySet<string> = new Set<InstancePolicy>([
    "terminateNewest",
    "terminateOldest",
    "prompt",
    "warn",
    "silent",
]);

/** `RunOptions.fromConfiguration`; `runOn: folderOpen` и `instanceLimit` > 1 — не поддержаны. */
function runOptionsFrom(value: unknown, label: string, problems: string[]): IRunOptions {
    if (!isObject(value)) return DEFAULT_RUN_OPTIONS;
    if (value.runOn === "folderOpen") {
        problems.push(
            `Warning: task '${label}': runOptions.runOn "folderOpen" is not supported; the task runs only when started.`,
        );
    }
    if (typeof value.instanceLimit === "number" && value.instanceLimit > 1) {
        problems.push(
            `Warning: task '${label}': runOptions.instanceLimit greater than 1 is not supported; one instance runs at a time.`,
        );
    }
    const policy = value.instancePolicy;
    return {
        reevaluateOnRerun:
            typeof value.reevaluateOnRerun === "boolean"
                ? value.reevaluateOnRerun
                : DEFAULT_RUN_OPTIONS.reevaluateOnRerun,
        instanceLimit: DEFAULT_RUN_OPTIONS.instanceLimit,
        instancePolicy:
            // Stryker disable next-line ConditionalExpression: эквивалентный — нестроки в наборе политик и так нет; проверка — для типов
            typeof policy === "string" && INSTANCE_POLICIES.has(policy)
                ? (policy as InstancePolicy)
                : DEFAULT_RUN_OPTIONS.instancePolicy,
    };
}

/** Аргументы: нестроковый элемент — ошибка эталона, элемент пропускается. */
function argsFrom(value: unknown, problems: string[]): CommandString[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const args: CommandString[] = [];
    for (const arg of value as readonly unknown[]) {
        const converted = commandStringFrom(arg);
        if (converted === undefined) {
            problems.push(
                `Error: command argument must either be a string or a quoted string. Provided value is:\n${JSON.stringify(arg, undefined, 4)}`,
            );
        } else {
            args.push(converted);
        }
    }
    return args;
}

/** Команда и её окружение: база задачи и секция платформы поверх (`CommandConfiguration.from`). */
interface ICommandParts {
    command?: CommandString;
    args?: CommandString[];
    options?: ICommandOptions;
    presentation?: Partial<IPresentationOptions>;
}

function commandPartsFrom(value: Json, problems: string[]): ICommandParts {
    const command = commandStringFrom(value.command);
    const args = argsFrom(value.args, problems);
    const options = optionsFrom(value.options, problems);
    const presentation = presentationFrom(value.presentation);
    return { command, args, options, presentation };
}

function withPlatform(base: ICommandParts, value: Json, platform: TaskPlatform, problems: string[]): ICommandParts {
    const section = value[platform];
    if (!isObject(section)) return base;
    const os = commandPartsFrom(section, problems);
    return {
        command: os.command ?? base.command,
        args: os.args ?? base.args,
        options: mergeOptions(base.options, os.options),
        presentation: { ...base.presentation, ...os.presentation },
    };
}

/** Тип записи tasks.json: без типа — процесс (`$customized` эталона с рантаймом Process). */
function runtimeOf(type: unknown): RuntimeType | undefined {
    if (type === undefined || type === null || type === "process") return "process";
    if (type === "shell") return "shell";
    return undefined;
}

interface IGlobals {
    readonly options?: ICommandOptions;
    readonly presentation?: Partial<IPresentationOptions>;
}

/**
 * Разобрать текст tasks.json папки. Битый JSON — пустой список и сообщение;
 * версия не 2.0.0 — тоже (схемы 0.1.0 у нас нет).
 */
export function parseTasksJson(
    text: string,
    folder: IWorkspaceFolder,
    platform: TaskPlatform,
): ITaskConfigurationParseResult {
    const problems: string[] = [];
    const errors: ParseError[] = [];
    const root: unknown = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length > 0) {
        const first = errors[0];
        // Текст эталона (`TaskSystem.invalidTaskJson`) и место первой ошибки.
        problems.push(
            "Error: The content of the tasks.json file has syntax errors. Please correct them before executing a task.",
            `${printParseErrorCode(first.error)} at offset ${String(first.offset)}.`,
        );
        return { tasks: [], problems };
    }
    if (!isObject(root)) return { tasks: [], problems };
    if (root.version !== "2.0.0") {
        problems.push(`Error: tasks.json version '${String(root.version)}' is not supported. Use version "2.0.0".`);
        return { tasks: [], problems };
    }
    if (root.inputs !== undefined) {
        problems.push("Warning: tasks.json inputs are not supported; tasks that use ${input:...} fail to start.");
    }
    const globalParts = withPlatform(commandPartsFrom(root, problems), root, platform, problems);
    const globals: IGlobals = { options: globalParts.options, presentation: globalParts.presentation };
    const tasks: ITask[] = [];
    // Stryker disable next-line ArrayDeclaration: эквивалентный — не объекты в списке задач пропускаются молча
    const externals: readonly unknown[] = Array.isArray(root.tasks) ? (root.tasks as readonly unknown[]) : [];
    for (const external of externals) {
        const task = taskFrom(external, folder, platform, globals, problems);
        if (task !== undefined) tasks.push(task);
    }
    return { tasks, problems };
}

function taskFrom(
    external: unknown,
    folder: IWorkspaceFolder,
    platform: TaskPlatform,
    globals: IGlobals,
    problems: string[],
): ITask | undefined {
    if (!isObject(external)) return undefined;
    const json = JSON.stringify(external, undefined, 4);
    const runtime = runtimeOf(external.type);
    if (runtime === undefined) {
        // Кастомизация задачи провайдера: эталон резолвит её `resolveTask`.
        problems.push(
            `Warning: task of type '${String(external.type)}' customizes a task of an extension; this is not supported yet. The task will be ignored.\n${json}`,
        );
        return undefined;
    }
    const label = typeof external.label === "string" ? external.label : undefined;
    if (label === undefined || label === "") {
        problems.push(`Error: a task must provide a label property. The task will be ignored.\n${json}`);
        return undefined;
    }
    const parts = withPlatform(commandPartsFrom(external, problems), external, platform, problems);
    if (parts.command === undefined) {
        problems.push(
            `Error: the task '${label}' neither specifies a command nor a dependsOn property. The task will be ignored. Its definition is:\n${json}`,
        );
        return undefined;
    }
    if (external.dependsOn !== undefined) {
        problems.push(`Warning: task '${label}': dependsOn is not supported; the task runs without its dependencies.`);
    }
    // Опции по умолчанию — `cwd: ${workspaceFolder}` (`CommandOptions.defaults`).
    const options = mergeOptions({ cwd: "${workspaceFolder}" }, mergeOptions(globals.options, parts.options));
    const presentation: IPresentationOptions = {
        ...DEFAULT_PRESENTATION,
        ...globals.presentation,
        ...parts.presentation,
    };
    const problemMatchers = matchersOf(external.problemMatcher);
    const id = `${WORKSPACE_TASK_ID_PREFIX}${label}`;
    return {
        _id: id,
        _label: label,
        name: label,
        type: runtime,
        source: { kind: "workspace", label: "Workspace", folder },
        // Определение задачи tasks.json (`CustomTask.getDefinition` эталона).
        definition: { type: runtime, _key: id, id },
        command: {
            runtime,
            name: parts.command,
            args: parts.args ?? [],
            // Stryker disable next-line ConditionalExpression: эквивалентный — слияние с опциями по умолчанию не даёт undefined; проверка — для типов
            ...(options !== undefined ? { options } : {}),
            presentation,
        },
        isBackground: external.isBackground === true || external.isWatching === true,
        ...(typeof external.detail === "string" ? { detail: external.detail } : {}),
        ...(typeof external.hide === "boolean" ? { hide: external.hide } : {}),
        ...groupFrom(external.group),
        problemMatchers,
        hasDefinedMatchers: external.problemMatcher !== undefined,
        runOptions: runOptionsFrom(external.runOptions, label, problems),
    };
}

/** `group`: строка (`"build"`) или `{ kind, isDefault }`; прочее — без группы. */
function groupFrom(value: unknown): { group?: ITaskGroup } {
    if (typeof value === "string") return { group: { id: value } };
    if (isObject(value) && typeof value.kind === "string") {
        return {
            group: { id: value.kind, ...(typeof value.isDefault === "boolean" ? { isDefault: value.isDefault } : {}) },
        };
    }
    return {};
}

/** Имена матчеров хранятся как есть (строки); исполнять их некому. */
function matchersOf(value: unknown): string[] {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return (value as readonly unknown[]).filter((m): m is string => typeof m === "string");
    return [];
}
