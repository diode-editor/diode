import type * as vscode from "vscode";

import { describeRejection } from "../../../base/common/describeRejection.ts";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import {
    contributedTaskId,
    createTaskIdentifier,
    type ITaskDefinitionSchema,
    parseTaskDefinitions,
} from "./taskIdentity.ts";
import {
    type IWireShellExecution,
    type IWireTask,
    type IWireTaskExecution,
    parseWireTaskEnded,
    parseWireTaskProcessEnded,
    parseWireTaskProcessStarted,
    parseWireTasks,
    parseWireTaskStarted,
    type WireTaskExecuteRequest,
    type WireTaskExecutionKind,
    type WireTaskScope,
} from "./taskWireTypes.ts";
import { callWithVscodeToken } from "./vscodeCancellation.ts";
import type { ExtensionOwner } from "./vscodeHostContext.ts";
import {
    CustomExecution,
    DisposableImpl,
    EventEmitter,
    ProcessExecution,
    ShellExecution,
    Task,
    TaskGroup,
    TaskScope,
} from "./vscodeTypes.ts";
import type { IWireExtensionDescription } from "./wireTypes.ts";

/**
 * `vscode.tasks` в субпроцессе (`ExtHostTask` эталона).
 *
 * Задачами владеет ядро (`contrib/tasks`): провайдер расширения отвечает на
 * `tasks.provideTasks`, `fetchTasks`/`executeTask`/`terminate` — запросы и
 * нотификации ядру, жизнь исполнений приезжает `tasks.didStart` /
 * `didStartProcess` / `didEndProcess` / `didEnd` — про ВСЕ задачи, в том числе
 * запущенные из палитры.
 *
 * Идентичность — как у эталона: расширение, вызвавшее `executeTask`, получает
 * в `execution.task` СВОЙ объект — исполнение заводится по id задачи ДО
 * отправки запроса, и старт, пришедший раньше ответа, его находит. Задача
 * из палитры или чужая — новый `Task` из описания ядра с именем и
 * `source` провайдера (по ним `taskExecutions` и ищут свою задачу).
 *
 * Id задачи: у задачи из ядра — её id (`handleId`); у своей — формула ядра
 * `${расширение}.${_key}` (`taskIdentity.ts`), посчитанная здесь по схемам
 * `contributes.taskDefinitions` из каталога расширений (у эталона — запрос
 * `$createTaskId`). По нему же находится колбэк `CustomExecution`: на старте
 * задачи он даёт pty, и тот подключается к терминалу задачи
 * (`attachPtyToTerminal` эталона).
 *
 * Нотификации ядра обрабатываются строго по очереди: старт задачи с
 * `CustomExecution` ждёт колбэк расширения, а события процесса не должны его
 * обгонять.
 */
export interface ITasksNamespace {
    registerTaskProvider(type: string, provider: vscode.TaskProvider): vscode.Disposable;
    fetchTasks(filter?: vscode.TaskFilter): Thenable<vscode.Task[]>;
    executeTask(task: vscode.Task): Thenable<vscode.TaskExecution>;
    readonly taskExecutions: readonly vscode.TaskExecution[];
    readonly onDidStartTask: vscode.Event<vscode.TaskStartEvent>;
    readonly onDidEndTask: vscode.Event<vscode.TaskEndEvent>;
    readonly onDidStartTaskProcess: vscode.Event<vscode.TaskProcessStartEvent>;
    readonly onDidEndTaskProcess: vscode.Event<vscode.TaskProcessEndEvent>;
}

export interface ITasksNamespaceDeps {
    readonly rpc: SubprocessRpc;
    /** Владелец создающего вызова — его id уходит в описание задачи и регистрацию провайдера. */
    readonly owner: ExtensionOwner;
    /** Папки воркспейса — область задачи из описания ядра. */
    readonly workspaceFolders: () => readonly vscode.WorkspaceFolder[] | undefined;
    /** Подключить pty `CustomExecution` к терминалу задачи по id инстанса. */
    readonly attachPty: (terminalId: number, pty: vscode.Pseudoterminal) => void;
    /** Каталог расширений — источник схем `contributes.taskDefinitions`. */
    readonly onDidReceiveCatalog: vscode.Event<readonly IWireExtensionDescription[]>;
}

/** Строка в stderr субпроцесса (хост зеркалит её в `extensions.host.stderr`). */
function report(message: string): void {
    console.error(`[ext-host] ${message}`);
}

/** Исполнение задачи (`TaskExecutionImpl` эталона). */
class TaskExecution implements vscode.TaskExecution {
    public constructor(
        public readonly id: string,
        public readonly task: vscode.Task,
        private readonly rpc: SubprocessRpc,
    ) {}

    public terminate(): void {
        this.rpc.notify("tasks.terminate", { id: this.id });
    }
}

/** Область задачи → провод: `TaskScope` числом, папка — путём; без области — воркспейс. */
function scopeToWire(scope: vscode.Task["scope"]): WireTaskScope {
    if (scope === undefined) return TaskScope.Workspace;
    return typeof scope === "number" ? scope : { folder: scope.uri.fsPath };
}

function shellToWire(execution: ShellExecution): IWireShellExecution {
    const options = execution.options === undefined ? {} : { options: execution.options };
    if (execution.commandLine !== undefined) return { commandLine: execution.commandLine, ...options };
    return { command: execution.command, args: execution.args, ...options };
}

function executionToWire(execution: vscode.Task["execution"]): WireTaskExecutionKind | undefined {
    if (execution instanceof ProcessExecution) {
        return {
            process: execution.process,
            args: execution.args,
            ...(execution.options === undefined ? {} : { options: execution.options }),
        };
    }
    if (execution instanceof ShellExecution) return shellToWire(execution);
    if (execution instanceof CustomExecution) return { customExecution: "customExecution" };
    return undefined;
}

/** `vscode.Task` → провод (`TaskDTO.from` эталона); источник — расширение `extensionId`. */
export function taskToWire(task: vscode.Task, extensionId: string): IWireTask {
    const group = task.group;
    return {
        ...(task instanceof Task && task.handleId !== undefined ? { id: task.handleId } : {}),
        name: task.name,
        execution: executionToWire(task.execution),
        definition: task.definition,
        isBackground: task.isBackground,
        source: { label: task.source, extensionId, scope: scopeToWire(task.scope) },
        ...(group === undefined
            ? {}
            : { group: { id: group.id, ...(group.isDefault === undefined ? {} : { isDefault: group.isDefault }) } }),
        ...(task.detail === undefined ? {} : { detail: task.detail }),
        presentationOptions: task.presentationOptions,
        problemMatchers: task.problemMatchers,
        hasDefinedMatchers: task instanceof Task ? task.hasDefinedMatchers : task.problemMatchers.length > 0,
        runOptions: task.runOptions,
    };
}

export function createTasksNamespace(deps: ITasksNamespaceDeps): ITasksNamespace {
    const { rpc, owner } = deps;
    const providers = new Map<number, { readonly provider: vscode.TaskProvider; readonly extensionId: string }>();
    let nextHandle = 0;
    /** Схемы типов из `contributes.taskDefinitions` — для ключа определения. */
    let schemas = new Map<string, ITaskDefinitionSchema>();
    /** Известные исполнения по id: свои (из `executeTask`) и начатые ядром. */
    const executions = new Map<string, TaskExecution>();
    /** Колбэки `CustomExecution` по id задачи. */
    const customExecutions = new Map<string, CustomExecution>();
    let queue: Promise<void> = Promise.resolve();

    const onDidStartTask = new EventEmitter<vscode.TaskStartEvent>();
    const onDidEndTask = new EventEmitter<vscode.TaskEndEvent>();
    const onDidStartTaskProcess = new EventEmitter<vscode.TaskProcessStartEvent>();
    const onDidEndTaskProcess = new EventEmitter<vscode.TaskProcessEndEvent>();

    deps.onDidReceiveCatalog((catalog) => {
        const next = new Map<string, ITaskDefinitionSchema>();
        for (const extension of catalog) {
            const contributes = extension.packageJSON.contributes as { readonly taskDefinitions?: unknown } | undefined;
            for (const schema of parseTaskDefinitions(extension.id, contributes?.taskDefinitions, report)) {
                next.set(schema.taskType, schema);
            }
        }
        schemas = next;
    });

    /** Id задачи у ядра: её `id` (кастомное исполнение из ядра), иначе формула ядра. */
    const idOf = (wire: IWireTask): string => {
        if (wire.id !== undefined) return wire.id;
        const keyed = createTaskIdentifier(wire.definition, schemas.get(wire.definition.type), report) ?? {
            // Stryker disable next-line StringLiteral: тип в id не входит (`contributedTaskId` — расширение и `_key`); строка — форма эталона
            type: "$executeOnly",
            _key: globalThis.crypto.randomUUID(),
        };
        return contributedTaskId(wire.source.extensionId, keyed);
    };

    /** Провод → `vscode.Task` (`TaskDTO.to` эталона); папки области нет — `undefined`. */
    const taskFromWire = (wire: IWireTask): vscode.Task | undefined => {
        const scope = scopeFromWire(wire.source.scope);
        if (scope === undefined) return undefined;
        const { _key: _ignored, ...definition } = wire.definition as IWireTask["definition"] & { _key?: unknown };
        const task = new Task(
            definition as vscode.TaskDefinition,
            scope,
            wire.name,
            wire.source.label,
            executionFromWire(wire),
            [...wire.problemMatchers],
        );
        task.isBackground = wire.isBackground;
        if (wire.group !== undefined) {
            const group = TaskGroup.from(wire.group.id) ?? new TaskGroup(wire.group.id, wire.group.id);
            task.group =
                wire.group.isDefault === true
                    ? Object.assign(new TaskGroup(group.id, group.label), { isDefault: true })
                    : group;
        }
        // Отсутствующие поля — те же дефолты, что у новой задачи (`{}`, `{}`, без detail).
        task.presentationOptions = { ...wire.presentationOptions } as vscode.TaskPresentationOptions;
        task.runOptions = { ...wire.runOptions };
        task.detail = wire.detail;
        task.handleId = idOf(wire);
        return task;
    };

    const scopeFromWire = (scope: WireTaskScope): vscode.Task["scope"] => {
        if (typeof scope === "number") return scope as vscode.TaskScope.Global | vscode.TaskScope.Workspace;
        return deps.workspaceFolders()?.find((folder) => folder.uri.fsPath === scope.folder);
    };

    const executionFromWire = (wire: IWireTask): ProcessExecution | ShellExecution | CustomExecution | undefined => {
        const execution = wire.execution;
        if (execution === undefined) return undefined;
        if ("customExecution" in execution) return customExecutions.get(idOf(wire));
        if ("process" in execution) {
            return new ProcessExecution(execution.process, [...execution.args], execution.options);
        }
        const options = execution.options as vscode.ShellExecutionOptions | undefined;
        if (execution.commandLine !== undefined) return new ShellExecution(execution.commandLine, options);
        if (execution.command === undefined) return undefined;
        return new ShellExecution(
            execution.command as string | vscode.ShellQuotedString,
            [...(execution.args ?? [])] as (string | vscode.ShellQuotedString)[],
            options,
        );
    };

    /** Исполнение по описанию ядра: своё (из `executeTask`) или новое из описания. */
    const executionOf = (wire: IWireTaskExecution): TaskExecution | undefined => {
        const known = executions.get(wire.id);
        if (known !== undefined) return known;
        const task = taskFromWire(wire.task);
        if (task === undefined) {
            report(`task "${wire.task.name}" started outside of the workspace folders; its events are skipped`);
            return undefined;
        }
        const execution = new TaskExecution(wire.id, task, rpc);
        executions.set(wire.id, execution);
        return execution;
    };

    /** Задачи провайдера → провод; колбэки `CustomExecution` запоминаются по id. */
    const tasksToWire = (tasks: readonly vscode.Task[], extensionId: string): IWireTask[] =>
        tasks.map((task) => {
            const wire = taskToWire(task, extensionId);
            if (task.execution instanceof CustomExecution) customExecutions.set(idOf(wire), task.execution);
            return wire;
        });

    const enqueue = (handler: () => Promise<void> | void): void => {
        queue = queue.then(handler).catch((error: unknown) => {
            report(`task event handler failed: ${describeRejection(error)}`);
        });
    };

    rpc.handleRequest("tasks.provideTasks", async (params, token) => {
        const entry = providers.get(params.handle);
        if (entry === undefined) throw new Error("no handler found");
        const tasks = await callWithVscodeToken(token, (vsToken) => entry.provider.provideTasks(vsToken));
        return tasksToWire(tasks ?? [], entry.extensionId);
    });

    rpc.handleNotification("tasks.didStart", (params) => {
        enqueue(async () => {
            const started = parseWireTaskStarted(params);
            if (started === null) return;
            const execution = executionOf(started.execution);
            const custom = customExecutions.get(started.execution.id);
            if (custom !== undefined) {
                try {
                    deps.attachPty(started.terminalId, await custom.callback(started.resolvedDefinition));
                } catch (error) {
                    report(
                        `CustomExecution of task "${started.execution.task.name}" failed: ${describeRejection(error)}`,
                    );
                }
            }
            if (execution !== undefined) onDidStartTask.fire({ execution });
        });
    });

    rpc.handleNotification("tasks.didStartProcess", (params) => {
        enqueue(() => {
            const value = parseWireTaskProcessStarted(params);
            if (value === null) return;
            const execution = executions.get(value.id);
            if (execution !== undefined) onDidStartTaskProcess.fire({ execution, processId: value.processId });
        });
    });

    rpc.handleNotification("tasks.didEndProcess", (params) => {
        enqueue(() => {
            const value = parseWireTaskProcessEnded(params);
            if (value === null) return;
            const execution = executions.get(value.id);
            if (execution !== undefined) onDidEndTaskProcess.fire({ execution, exitCode: value.exitCode });
        });
    });

    rpc.handleNotification("tasks.didEnd", (params) => {
        enqueue(() => {
            const value = parseWireTaskEnded(params);
            // Конец неизвестного исполнения эталон пропускает: его начала тут не видели.
            const execution = value === null ? undefined : executions.get(value.execution.id);
            if (execution === undefined) return;
            executions.delete(execution.id);
            onDidEndTask.fire({ execution });
        });
    });

    function registerTaskProvider(type: string, provider: vscode.TaskProvider): vscode.Disposable {
        const extensionId = owner.current ?? "";
        const handle = nextHandle++;
        providers.set(handle, { provider, extensionId });
        rpc.notify("tasks.registerProvider", { handle, type, extensionId });
        return new DisposableImpl(() => {
            providers.delete(handle);
            rpc.notify("tasks.unregisterProvider", { handle });
        });
    }

    async function fetchTasks(filter?: vscode.TaskFilter): Promise<vscode.Task[]> {
        const wire = parseWireTasks(
            await rpc.request("tasks.fetch", filter?.type === undefined ? {} : { type: filter.type }),
        );
        return wire.map(taskFromWire).filter((task): task is vscode.Task => task !== undefined);
    }

    function executeTask(task: vscode.Task): Promise<vscode.TaskExecution> {
        // Владелец — только в синхронной части вызова (`ExtensionOwner`).
        const extensionId = owner.current ?? "";
        const handleId = task instanceof Task ? task.handleId : undefined;
        if (task.execution === undefined && handleId === undefined) {
            return Promise.reject(new Error("Tasks to execute must include an execution"));
        }
        let id: string;
        let request: WireTaskExecuteRequest;
        if (handleId === undefined) {
            const wire = taskToWire(task, extensionId);
            id = idOf(wire);
            if (task.execution instanceof CustomExecution) customExecutions.set(id, task.execution);
            request = { task: wire };
        } else {
            id = handleId;
            request = { id };
        }
        // Своё исполнение заводится ДО запроса: старт может прийти раньше ответа.
        // Уже известное (задача бежит) — оно и есть, как `getTaskExecution` эталона.
        const known = executions.get(id);
        const execution = known ?? new TaskExecution(id, task, rpc);
        executions.set(id, execution);
        return rpc.request("tasks.execute", request).then(
            () => execution,
            (error: unknown) => {
                if (known === undefined) executions.delete(id);
                throw error;
            },
        );
    }

    return {
        registerTaskProvider,
        fetchTasks,
        executeTask,
        get taskExecutions(): readonly vscode.TaskExecution[] {
            return [...executions.values()];
        },
        onDidStartTask: onDidStartTask.event,
        onDidEndTask: onDidEndTask.event,
        onDidStartTaskProcess: onDidStartTaskProcess.event,
        onDidEndTaskProcess: onDidEndTaskProcess.event,
    };
}
