// Исполнение задач во встроенном терминале (`terminalTaskSystem.ts` эталона):
// командная строка шелла или процесс, терминал задачи по `presentation.panel`
// (dedicated / shared / new — с честным переиспользованием ждущего
// терминала), ожидание после выхода, показ терминала по `reveal`/`focus` и
// события жизни задачи в порядке эталона: Start → Active → ProcessStarted →
// … → ProcessEnded → Inactive → End (и Terminated, если терминал закрыли).
// Problem matchers не исполняются (docs/TODO/Tasks.md).

import * as paths from "node:path";

import { Emitter } from "../../../../base/common/event.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import { formatMessageForTerminal } from "../../../../platform/terminal/common/terminalStrings.ts";
import type { PanelService } from "../../../browser/parts/panel/panelService.ts";
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

/** Событие жизни задачи (`ITaskEvent` эталона в объёме, нужном потребителям). */
export type ITaskEvent =
    | { readonly kind: "changed" }
    | {
          readonly kind: "start";
          readonly task: ITask;
          readonly terminalId: number;
          /** Определение с подставленными переменными — его получает `CustomExecution`. */
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

/** Итог исполнения (`ITaskSummary`): код выхода, `undefined` — терминал закрыли. */
export interface ITaskSummary {
    readonly exitCode: number | undefined;
}

/** Исход запуска (`ITaskExecuteResult`): запущена или такая задача уже бежит. */
export type ITaskExecuteResult =
    | { readonly kind: "started"; readonly task: ITask; readonly promise: Promise<ITaskSummary> }
    | { readonly kind: "active"; readonly task: ITask; readonly promise: Promise<ITaskSummary> };

/** Вид процесса терминала: переиспользуются терминалы только своего вида. */
type TerminalKind = "process" | "custom";

interface ITerminalData {
    /** `getMapKey` задачи, которая бежала в терминале последней. */
    lastTask: string;
    readonly group: string | undefined;
    readonly kind: TerminalKind;
}

/** Ждущий терминал `shared`-задачи. */
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

/** Готовый запуск: как создать или перезапустить терминал задачи. */
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

/** Окружение запуска: значения переменных и платформа. */
export interface ITaskRunContext {
    readonly variables: ITaskVariableContext;
    readonly platform: TaskPlatform;
}

/** Экранирование по шеллу (`_shellQuotes` эталона). */
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
/** Экранирование по ОС, когда шелл не из таблицы (`_osShellQuotes`). */
const OS_SHELL_QUOTES: Readonly<Record<TaskPlatform, IShellQuotingOptions>> = {
    linux: POSIX_QUOTES,
    osx: POSIX_QUOTES,
    windows: POWERSHELL_QUOTES,
};

/**
 * Значение `waitOnExit` терминала задачи (`getWaitOnExitValue` эталона):
 * ждать ли после выхода и что тогда напечатать.
 */
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
    /** Бегущие задачи по `getMapKey`. */
    private readonly active = new Map<string, IActiveTask>();
    /** Терминалы задач по id инстанса. */
    private readonly terminals = new Map<number, ITerminalData>();
    /** `dedicated`: терминал, закреплённый за задачей (`_sameTaskTerminals`). */
    private readonly sameTaskTerminals = new Map<string, IIdleTerminal>();
    /**
     * `shared`: ждущие терминалы, последним освободившийся — первым
     * (`_idleTaskTerminals` с `Touch.AsOld` эталона): ключ задачи → id.
     */
    private idleTaskTerminals: IIdleTerminal[] = [];
    private lastTask: { readonly task: ITask; readonly launch: ILaunch } | undefined;
    private customTerminals: IExtensionPtyTerminals | undefined;

    private readonly onDidStateChangeEmitter = this.register(new Emitter<ITaskEvent>());
    public readonly onDidStateChange = this.onDidStateChangeEmitter.event;

    public constructor(
        private readonly terminalService: TerminalService,
        private readonly panel: PanelService,
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

    /** Мост pty расширений — без него задачу с `CustomExecution` запустить нечем. */
    public setCustomExecutionTerminals(terminals: IExtensionPtyTerminals | undefined): void {
        this.customTerminals = terminals;
    }

    /** Бегущие задачи в порядке запуска. */
    public getActiveTasks(): readonly ITask[] {
        return [...this.active.values()].map((a) => a.task);
    }

    /**
     * Запустить задачу. Такая же уже бежит — `active` с её обещанием (решение,
     * что делать, — у сервиса: `instancePolicy`). Переменные и командная
     * строка считаются здесь; неподставимая переменная — отказ.
     */
    public run(task: ITask, context: ITaskRunContext): ITaskExecuteResult {
        const running = this.active.get(getMapKey(task));
        if (running !== undefined) return { kind: "active", task: running.task, promise: running.summary.promise };
        return this.execute(task, this.launchOf(task, context));
    }

    /**
     * Повторить последнюю задачу (`rerun` эталона): с `reevaluateOnRerun`
     * переменные считаются заново, без него — запуск тем же, чем в прошлый раз.
     * Нечего повторять — `undefined`.
     */
    public rerun(context: ITaskRunContext): ITaskExecuteResult | undefined {
        if (this.lastTask === undefined) return undefined;
        const { task, launch } = this.lastTask;
        if (task.runOptions.reevaluateOnRerun) return this.run(task, context);
        const running = this.active.get(getMapKey(task));
        if (running !== undefined) return { kind: "active", task: running.task, promise: running.summary.promise };
        return this.execute(task, launch);
    }

    /**
     * Остановить задачу: её терминал закрывается (`terminal.dispose()` эталона),
     * задача кончается событием Terminated. `false` — она не бежит.
     */
    public async terminate(task: ITask): Promise<boolean> {
        const running = this.active.get(getMapKey(task));
        if (running === undefined) return false;
        this.terminalService.closeInstance(running.terminalId, "user");
        await running.summary.promise;
        return true;
    }

    /** Остановить все бегущие задачи. */
    public async terminateAll(): Promise<void> {
        await Promise.all(this.getActiveTasks().map((task) => this.terminate(task)));
    }

    /**
     * Показать терминал задачи (`revealTask`): бегущей — её, иначе того, где
     * она бежала последней. `false` — терминала у задачи нет.
     */
    public revealTask(task: ITask): boolean {
        const id = this.terminalOf(task);
        if (id === undefined) return false;
        this.show(id, false);
        return true;
    }

    /** Виден ли терминал задачи прямо сейчас (`isTaskVisible`). */
    public isTaskVisible(task: ITask): boolean {
        const id = this.terminalOf(task);
        return (
            id !== undefined &&
            this.panel.visible &&
            this.panel.getActiveViewId() === TERMINAL_VIEW_ID &&
            // Stryker disable next-line OptionalChaining: эквивалентный — у задачи с терминалом активный инстанс есть всегда (снятые терминалы забываются)
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
        // Процесс шелла у нас готов сразу (pid есть при создании); у pty
        // расширения процесса нет — эталон отдаёт pid -1 (`ExtHostPseudoterminal`).
        this.fire({ kind: "processStarted", task, terminalId: instance.id, processId: instance.processId ?? -1 });
        this.reveal(task, instance.id);
        this.fire({ kind: "changed" });
        return { kind: "started", task, promise: active.summary.promise };
    }

    /**
     * Терминал под задачу: переиспользовать ждущий (`dedicated` — свой, `shared`
     * — свой или любой той же `presentation.group`) или завести новый.
     */
    private acquireTerminal(task: ITask, launch: ILaunch): [ITerminalInstance, ITerminalData] {
        const key = getMapKey(task);
        const { panel, group, clear } = task.command.presentation;
        const reuse = this.takeTerminalToReuse(key, panel, group, launch.kind);
        if (reuse !== undefined) {
            // Ждущий терминал перезапускается всегда: снятый уже забыт (`forgetTerminal`).
            const relaunched = this.terminalService.relaunchInstance(reuse.id, {
                name: launch.name,
                // Stryker disable ConditionalExpression: ключ со значением undefined TerminalService читает как отсутствующий — спреды только ради типов
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
            // Stryker disable next-line CallExpression: эквивалентный — своя запись перезаписывается на выходе задачи, а снятый терминал её и так убирает
            this.sameTaskTerminals.delete(key);
            return own?.data.kind === kind ? own : undefined;
        }
        if (panel !== "shared") return undefined;
        // Свой ждущий терминал — всегда; иначе первый ждущий той же группы.
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
            // Stryker disable ConditionalExpression: ключ со значением undefined TerminalService читает как отсутствующий — спреды только ради типов
            ...(launch.shellPath !== undefined ? { shellPath: launch.shellPath } : {}),
            ...(launch.shellArgs !== undefined ? { shellArgs: launch.shellArgs } : {}),
            ...(launch.cwd !== undefined ? { cwd: launch.cwd } : {}),
            ...(launch.env !== undefined ? { env: launch.env } : {}),
            ...(launch.message !== undefined ? { message: launch.message } : {}),
            // Stryker restore ConditionalExpression
            waitOnExit: launch.waitOnExit,
        });
    }

    /**
     * Процесс терминала задачи вышел (`reason` нет) или терминал закрыт
     * (`reason` есть). Задача кончается один раз: ждущий терминал, закрытый
     * клавишей после выхода, задачу уже не трогает.
     */
    private handleExit(terminalId: number, exitCode: number | undefined, reason: TerminalExitReason | undefined): void {
        const entry = [...this.active].find(([, a]) => a.terminalId === terminalId);
        if (entry === undefined) return;
        const [key, active] = entry;
        const { task } = active;
        this.active.delete(key);
        this.fire({ kind: "changed" });
        // Вышедший сам процесс оставляет терминал ждать — его можно переиспользовать.
        if (reason === undefined) {
            const idle: IIdleTerminal = { key, id: terminalId, data: active.terminal };
            if (task.command.presentation.panel === "dedicated") this.sameTaskTerminals.set(key, idle);
            if (task.command.presentation.panel === "shared") {
                this.idleTaskTerminals = [idle, ...this.idleTaskTerminals.filter((other) => other.key !== key)];
            }
            // `silent` показывает терминал, только если задача упала.
            if (task.command.presentation.reveal === "silent" && exitCode !== 0) this.show(terminalId, false);
        }
        this.fire({ kind: "processEnded", task, terminalId, exitCode });
        this.fire({ kind: "inactive", task, terminalId });
        this.fire({ kind: "end", task, terminalId });
        if (reason !== undefined) this.fire({ kind: "terminated", task, terminalId, exitReason: reason });
        active.summary.resolve({ exitCode });
    }

    /** Терминал снят — переиспользовать его больше нельзя. */
    private forgetTerminal(id: number): void {
        const data = this.terminals.get(id);
        if (data === undefined) return;
        this.terminals.delete(id);
        // Stryker disable next-line ConditionalExpression,CallExpression: оставленная ссылка на снятый свой терминал ненаблюдаема — перезапуск снятого id даёт undefined и новый терминал
        if (this.sameTaskTerminals.get(data.lastTask)?.id === id) this.sameTaskTerminals.delete(data.lastTask);
        this.idleTaskTerminals = this.idleTaskTerminals.filter((idle) => idle.id !== id);
    }

    /** `reveal: always` или `focus` — показать терминал задачи при старте. */
    private reveal(task: ITask, terminalId: number): void {
        const { reveal, focus } = task.command.presentation;
        if (focus || reveal === "always") this.show(terminalId, focus);
    }

    private show(terminalId: number, focus: boolean): void {
        this.terminalService.showInstance(terminalId);
        this.panel.setActiveView(TERMINAL_VIEW_ID);
        this.panel.setVisible(true);
        if (focus) this.terminalService.focusActive();
    }

    private fire(event: ITaskEvent): void {
        this.onDidStateChangeEmitter.fire(event);
    }

    // ── Запуск: переменные, командная строка, сообщение ───────────────────────

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
            // Stryker disable next-line ConditionalExpression: эквивалентный — env: undefined отсеивается при создании и перезапуске терминала
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
            // Stryker disable next-line StringLiteral: эквивалентный — без команды подставленная строка пуста, и любой исходник с пробелами оставляет её как есть
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

    /** Относительный `cwd` — от папки задачи; без `cwd` — папка или каталог терминала. */
    private cwdOf(task: ITask, cwd: string | undefined): string | undefined {
        const folder = getTaskFolder(task)?.uri.fsPath;
        if (cwd === undefined) return folder;
        return paths.isAbsolute(cwd) || folder === undefined ? cwd : paths.join(folder, cwd);
    }

    /** Шелл задачи: свой из `options.shell` или системный, и признак «задан явно». */
    private shellOf(
        shell: IShellConfiguration | undefined,
        resolve: (value: string) => string,
    ): { executable: string; args: string[]; specified: boolean } {
        const fallback = this.defaultShell();
        const executable = shell?.executable === undefined ? fallback : resolve(shell.executable);
        // Свой шелл — без аргументов системного (у эталона — аргументы профиля).
        const args = shell?.args === undefined ? [] : shell.args.map(resolve);
        return { executable, args, specified: shell?.executable !== undefined };
    }
}

/** «Executing task: …» — печатается в терминал перед выводом задачи при `echo`. */
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

/** Строки определения с подставленными переменными (как резолв определения `CustomExecution` эталона). */
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

/** Пути шелла разбираются по правилам его ОС (у эталона — ОС процесса, это она и есть). */
function pathsOf(platform: TaskPlatform): typeof paths.posix {
    return platform === "windows" ? paths.win32 : paths.posix;
}

/**
 * Аргументы шелла (`_createShellLaunchConfig`): на posix — `-c` (если шелл не
 * задан явно), на Windows — по шеллу (`-Command`, `/d /c`, `-c`, `-e`);
 * последним — командная строка.
 */
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

/** `_addAllArgument`: аргумент шелла не дублируется, если он уже стоит с хвостом не-флагов. */
function addAllArguments(toAdd: readonly string[], configured: readonly string[]): string[] {
    const combined = [...configured];
    for (const element of toAdd) {
        // У эталона ещё проверка «не последний»: у последнего хвост пуст, и ответ
        // тот же (`false`) — она опущена.
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

/**
 * Командная строка шелла (`_buildShellCommandLine` эталона): команда и
 * аргументы, экранированные по правилам шелла; строка без аргументов уходит
 * как есть.
 */
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
        // Уже в кавычках целиком — оставить как есть. Проверка длины эталона
        // (`>= 2`) опущена: одна кавычка и цикл ниже даёт `false`.
        // Stryker disable next-line ConditionalExpression: `q !== undefined` → true эквивалентен — find вернёт тот же undefined
        const first = [quotes.strong, quotes.weak].find((q) => q !== undefined && value.startsWith(q));
        if (first !== undefined && value.endsWith(first)) return false;
        let quote: string | undefined;
        // Stryker disable next-line EqualityOperator: эквивалентный — лишний шаг за концом строки (символ undefined) ничего не меняет
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

    // Строка без аргументов — старая модель «вся командная строка в command»:
    // как есть, если подстановка её не изменила или исходник и так с пробелами.
    if (
        args.length === 0 &&
        typeof command === "string" &&
        // Stryker disable next-line ConditionalExpression: эквивалентные — та же строка без нужды в кавычках ниже тоже уходит как есть, а needsQuotes объекта — false
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
