// A subset of the 2.0.0 schema: unsupported parts don't drop the task but are reported
// as a warning in the `tasks` log.

import { parse, type ParseError, printParseErrorCode } from "jsonc-parser";

import type { IWorkspaceFolder } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { createTaskIdentifier, type ITaskDefinitionSchema } from "../../../api/common/taskIdentity.ts";

import { parseProblemMatcher } from "./problemMatcher.ts";
import {
    type CommandString,
    DEFAULT_PRESENTATION,
    DEFAULT_RUN_OPTIONS,
    type ICommandOptions,
    type IConfiguringTask,
    type InstancePolicy,
    type IPresentationOptions,
    type IRunOptions,
    type IShellConfiguration,
    type IShellQuotingOptions,
    type ITask,
    type ITaskCustomization,
    type ITaskGroup,
    type PanelKind,
    type RevealKind,
    type RevealProblemKind,
    type RuntimeType,
    type ShellQuoting,
    type TaskProblemMatcher,
} from "./tasks.ts";

export type TaskPlatform = "windows" | "osx" | "linux";

export function currentTaskPlatform(platform: NodeJS.Platform = process.platform): TaskPlatform {
    if (platform === "win32") return "windows";
    if (platform === "darwin") return "osx";
    return "linux";
}

/** `problems` go to the `tasks` log, with upstream texts where upstream has them. */
export interface ITaskConfigurationParseResult {
    readonly tasks: readonly ITask[];
    readonly configuring: readonly IConfiguringTask[];
    readonly problems: readonly string[];
}

export type TaskDefinitionLookup = (type: string) => ITaskDefinitionSchema | undefined;

/** `$core` is the `extensionId` of such tasks in upstream's DTO. */
export const WORKSPACE_TASK_ID_PREFIX = "$core.";

type Json = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is Json {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
    return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** Upstream's `ShellQuoting.from`: unknown means `strong`. */
function quotingFrom(value: unknown): ShellQuoting {
    return value === "escape" || value === "weak" ? value : "strong";
}

/** A string array is joined with spaces. */
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

/** A non-string `cwd` is an upstream warning. */
function optionsFrom(value: unknown, problems: string[]): ICommandOptions | undefined {
    if (!isObject(value)) return undefined;
    if (value.cwd !== undefined && typeof value.cwd !== "string") {
        problems.push(`Warning: options.cwd must be of type string. Ignoring value ${JSON.stringify(value.cwd)}`);
    }
    const env = envFrom(value.env);
    const shell = shellFrom(value.shell);
    // Empty env/shell are dropped by merging with the default options (`mergeOptions`).
    return { ...(typeof value.cwd === "string" ? { cwd: value.cwd } : {}), env, shell };
}

/** The source's `cwd` and shell override the target; environments combine (source on top). */
function mergeOptions(
    target: ICommandOptions | undefined,
    source: ICommandOptions | undefined,
): ICommandOptions | undefined {
    if (source === undefined) return target;
    if (target === undefined) return source;
    const env = target.env === undefined ? source.env : { ...target.env, ...source.env };
    const shell = source.shell === undefined ? target.shell : { ...target.shell, ...source.shell };
    return {
        // Stryker disable next-line ConditionalExpression: equivalent: the final options merge with the default `cwd`, so an empty key does not survive
        ...((source.cwd ?? target.cwd) !== undefined ? { cwd: source.cwd ?? target.cwd } : {}),
        ...(env !== undefined ? { env } : {}),
        ...(shell !== undefined ? { shell } : {}),
    };
}

/** Unknown means `always`. */
function revealFrom(value: string): RevealKind {
    const lower = value.toLowerCase();
    return lower === "silent" || lower === "never" ? lower : "always";
}

/** Upstream's `RevealProblemKind.fromString`: unknown means `onProblem`. */
function revealProblemsFrom(value: string): RevealProblemKind {
    const lower = value.toLowerCase();
    if (lower === "always" || lower === "never") return lower;
    return "onProblem";
}

/** Unknown means `shared`. */
function panelFrom(value: string): PanelKind {
    const lower = value.toLowerCase();
    return lower === "dedicated" || lower === "new" ? lower : "shared";
}

/** Empty means `undefined`. */
function presentationFrom(value: unknown): Partial<IPresentationOptions> | undefined {
    if (!isObject(value)) return undefined;
    return {
        ...(typeof value.echo === "boolean" ? { echo: value.echo } : {}),
        ...(typeof value.reveal === "string" ? { reveal: revealFrom(value.reveal) } : {}),
        ...(typeof value.revealProblems === "string"
            ? { revealProblems: revealProblemsFrom(value.revealProblems) }
            : {}),
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

/** `runOn: folderOpen` and `instanceLimit` > 1 are not supported. */
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
            // Stryker disable next-line ConditionalExpression: equivalent: the policy set has no non-strings anyway; the check is for types
            typeof policy === "string" && INSTANCE_POLICIES.has(policy)
                ? (policy as InstancePolicy)
                : DEFAULT_RUN_OPTIONS.instancePolicy,
    };
}

/** A non-string element is an upstream error; the element is skipped. */
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

/** The platform section overrides the task base. */
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

/** No type means process (upstream's `$customized` with the Process runtime). */
function runtimeOf(type: unknown): RuntimeType | undefined {
    if (type === undefined || type === null || type === "process") return "process";
    if (type === "shell") return "shell";
    return undefined;
}

interface IGlobals {
    readonly options?: ICommandOptions;
    readonly presentation?: Partial<IPresentationOptions>;
}

/** Broken JSON or a version other than 2.0.0 (we have no 0.1.0 schema) gives an empty list and a message. */
export function parseTasksJson(
    text: string,
    folder: IWorkspaceFolder,
    platform: TaskPlatform,
    definitionOf: TaskDefinitionLookup = () => undefined,
): ITaskConfigurationParseResult {
    const problems: string[] = [];
    const errors: ParseError[] = [];
    const root: unknown = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length > 0) {
        const first = errors[0];
        // Upstream text (`TaskSystem.invalidTaskJson`) and the location of the first error.
        problems.push(
            "Error: The content of the tasks.json file has syntax errors. Please correct them before executing a task.",
            `${printParseErrorCode(first.error)} at offset ${String(first.offset)}.`,
        );
        return { tasks: [], configuring: [], problems };
    }
    if (!isObject(root)) return { tasks: [], configuring: [], problems };
    if (root.version !== "2.0.0") {
        problems.push(`Error: tasks.json version '${String(root.version)}' is not supported. Use version "2.0.0".`);
        return { tasks: [], configuring: [], problems };
    }
    if (root.inputs !== undefined) {
        problems.push("Warning: tasks.json inputs are not supported; tasks that use ${input:...} fail to start.");
    }
    const globalParts = withPlatform(commandPartsFrom(root, problems), root, platform, problems);
    const globals: IGlobals = { options: globalParts.options, presentation: globalParts.presentation };
    const tasks: ITask[] = [];
    const configuring: IConfiguringTask[] = [];
    // Stryker disable next-line ArrayDeclaration: equivalent: non-objects in the task list are skipped silently
    const externals: readonly unknown[] = Array.isArray(root.tasks) ? (root.tasks as readonly unknown[]) : [];
    externals.forEach((external, index) => {
        if (!isObject(external)) return;
        const runtime = runtimeOf(external.type);
        if (runtime === undefined) {
            const configuringTask = configuringTaskFrom(external, folder, platform, index, definitionOf, problems);
            if (configuringTask !== undefined) configuring.push(configuringTask);
            return;
        }
        const task = taskFrom(external, runtime, folder, platform, globals, index, problems);
        if (task !== undefined) tasks.push(task);
    });
    return { tasks, configuring, problems };
}

/** A type without a schema is an upstream error. */
function configuringTaskFrom(
    external: Json,
    folder: IWorkspaceFolder,
    platform: TaskPlatform,
    index: number,
    definitionOf: TaskDefinitionLookup,
    problems: string[],
): IConfiguringTask | undefined {
    const type = external.type;
    if (typeof type !== "string" || type === "") {
        problems.push(
            `Error: tasks configuration must have a type property. The configuration will be ignored.\n${JSON.stringify(external, undefined, 4)}\n`,
        );
        return undefined;
    }
    const schema = definitionOf(type);
    if (schema === undefined) {
        problems.push(
            `Error: there is no registered task type '${type}'. Did you miss installing an extension that provides a corresponding task provider?`,
        );
        return undefined;
    }
    const configures = createTaskIdentifier({ ...external, type }, schema, (message) => problems.push(message));
    if (configures === undefined) {
        problems.push(
            `Error: the task configuration '${JSON.stringify(external)}' is using an unknown type. The task configuration will be ignored.`,
        );
        return undefined;
    }
    const label = typeof external.label === "string" && external.label !== "" ? external.label : undefined;
    return {
        _id: `${schema.extensionId}.${configures._key}`,
        _label: label ?? fallbackLabel(configures, schema),
        type,
        configures,
        folder,
        configIndex: index,
        customization: customizationFrom(external, label, platform, problems),
        element: external,
    };
}

/** Label of an entry without `label`, as upstream. */
function fallbackLabel(configures: Json, schema: ITaskDefinitionSchema): string {
    const required = schema.required.map((name) => configures[name]).find((value) => Boolean(value));
    if (required === undefined) return schema.taskType;
    return `${schema.taskType}: ${typeof required === "string" ? required : JSON.stringify(required)}`;
}

function customizationFrom(
    external: Json,
    label: string | undefined,
    platform: TaskPlatform,
    problems: string[],
): ITaskCustomization {
    const section = external[platform];
    const os: Json = isObject(section) ? section : {};
    // Merging with empty options drops unset env/shell (as a task does with the default options).
    const options =
        mergeOptions(mergeOptions({}, optionsFrom(external.options, problems)), optionsFrom(os.options, problems)) ??
        {};
    const presentation = { ...presentationFrom(external.presentation), ...presentationFrom(os.presentation) };
    const name = label ?? String(external.type);
    if (external.dependsOn !== undefined) {
        problems.push(`Warning: task '${name}': dependsOn is not supported; the task runs without its dependencies.`);
    }
    return {
        ...(label !== undefined ? { label } : {}),
        ...(typeof external.detail === "string" ? { detail: external.detail } : {}),
        ...(typeof external.hide === "boolean" ? { hide: external.hide } : {}),
        ...groupFrom(external.group),
        ...(typeof external.isBackground === "boolean" ? { isBackground: external.isBackground } : {}),
        ...matchersWithOs(external, os, problems),
        presentation,
        ...(Object.keys(options).length > 0 ? { options } : {}),
        runOptions: runOptionsFrom(external.runOptions, name, problems),
    };
}

/** Id, definition and execution stay from the provider's task. */
export function createCustomizedTask(contributed: ITask, configuring: IConfiguringTask): ITask {
    const custom = configuring.customization;
    const options = mergeOptions(contributed.command.options, custom.options);
    const group = custom.group ?? contributed.group;
    const detail = custom.detail ?? contributed.detail;
    return {
        ...contributed,
        _label: custom.label ?? contributed._label,
        name: custom.label ?? contributed.name,
        command: {
            ...contributed.command,
            ...(options !== undefined ? { options } : {}),
            presentation: { ...contributed.command.presentation, ...custom.presentation },
        },
        isBackground: custom.isBackground ?? contributed.isBackground,
        ...(detail !== undefined ? { detail } : {}),
        ...(custom.hide !== undefined ? { hide: custom.hide } : {}),
        ...(group !== undefined ? { group } : {}),
        problemMatchers: custom.problemMatchers ?? contributed.problemMatchers,
        runOptions: custom.runOptions,
        configIndex: configuring.configIndex,
    };
}

function taskFrom(
    external: Json,
    runtime: RuntimeType,
    folder: IWorkspaceFolder,
    platform: TaskPlatform,
    globals: IGlobals,
    index: number,
    problems: string[],
): ITask | undefined {
    const json = JSON.stringify(external, undefined, 4);
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
    // Default options are `cwd: ${workspaceFolder}` (`CommandOptions.defaults`).
    const options = mergeOptions({ cwd: "${workspaceFolder}" }, mergeOptions(globals.options, parts.options));
    const presentation: IPresentationOptions = {
        ...DEFAULT_PRESENTATION,
        ...globals.presentation,
        ...parts.presentation,
    };
    const matchers = matchersWithOs(external, platformSection(external, platform), problems);
    const id = `${WORKSPACE_TASK_ID_PREFIX}${label}`;
    return {
        _id: id,
        _label: label,
        name: label,
        type: runtime,
        source: { kind: "workspace", label: "Workspace", folder },
        // The tasks.json task definition (upstream's `CustomTask.getDefinition`).
        definition: { type: runtime, _key: id, id },
        command: {
            runtime,
            name: parts.command,
            args: parts.args ?? [],
            // Stryker disable next-line ConditionalExpression: equivalent: merging with default options never gives undefined; the check is for types
            ...(options !== undefined ? { options } : {}),
            presentation,
        },
        isBackground: external.isBackground === true || external.isWatching === true,
        ...(typeof external.detail === "string" ? { detail: external.detail } : {}),
        ...(typeof external.hide === "boolean" ? { hide: external.hide } : {}),
        ...groupFrom(external.group),
        problemMatchers: matchers.problemMatchers ?? [],
        hasDefinedMatchers: matchers.problemMatchers !== undefined,
        runOptions: runOptionsFrom(external.runOptions, label, problems),
        configIndex: index,
    };
}

function groupFrom(value: unknown): { group?: ITaskGroup } {
    if (typeof value === "string") return { group: { id: value } };
    if (isObject(value) && typeof value.kind === "string") {
        return {
            group: { id: value.kind, ...(typeof value.isDefault === "boolean" ? { isDefault: value.isDefault } : {}) },
        };
    }
    return {};
}

function platformSection(external: Json, platform: TaskPlatform): Json {
    const section = external[platform];
    return isObject(section) ? section : {};
}

/** Upstream's `ProblemMatcherConverter.fromWithOsConfig`: the platform section's matchers replace the task's. */
function matchersWithOs(
    external: Json,
    os: Json,
    problems: string[],
): { problemMatchers?: readonly TaskProblemMatcher[] } {
    const value = os.problemMatcher ?? external.problemMatcher;
    return value === undefined ? {} : { problemMatchers: matchersOf(value, problems) };
}

/**
 * A name stays a name: it is resolved when the task runs (an unknown one is reported then). An inline matcher
 * is parsed here; a broken one is reported and skipped.
 */
function matchersOf(value: unknown, problems: string[]): TaskProblemMatcher[] {
    const items: readonly unknown[] = Array.isArray(value) ? (value as readonly unknown[]) : [value];
    const result: TaskProblemMatcher[] = [];
    for (const item of items) {
        if (typeof item === "string") {
            result.push(item);
            continue;
        }
        const matcher = parseProblemMatcher(isObject(item) ? item : {}, (message) => problems.push(message));
        if (matcher !== undefined) result.push(matcher);
    }
    return result;
}
