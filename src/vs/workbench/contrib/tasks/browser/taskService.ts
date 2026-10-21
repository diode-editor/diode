import { Emitter, type Event } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import {
    type ContextKeyService,
    ContextKeyServiceDIToken,
} from "../../../../platform/contextkey/common/contextKeyService.ts";
import { type IFileService, IFileServiceDIToken } from "../../../../platform/files/common/files.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ILogService } from "../../../../platform/log/common/iLogService.ts";
import { ILogServiceDIToken } from "../../../../platform/log/common/iLogServiceDIToken.ts";
import type {
    IWorkspaceContextService,
    IWorkspaceFolder,
} from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { IWorkspaceContextServiceDIToken } from "../../../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import { workspaceConfigFilePath } from "../../../../platform/workspace/common/workspaceConfigFolder.ts";
import {
    createTaskIdentifier,
    type IKeyedTaskIdentifier,
    type ITaskDefinitionSchema,
    type ITaskIdentifier,
} from "../../../api/common/taskIdentity.ts";
import {
    type QuickInputService,
    QuickInputServiceDIToken,
} from "../../../browser/parts/quickinput/quickInputService.ts";
import { type ViewsService, ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";
import { type DialogService, DialogServiceDIToken } from "../../../services/dialogs/browser/dialogService.ts";
import { EditorServiceDIToken, type IEditorService } from "../../../services/editor/common/editorService.ts";
import {
    type NotificationService,
    NotificationServiceDIToken,
} from "../../../services/notification/browser/notificationService.ts";
import { OUTPUT_VIEW_ID } from "../../../services/output/common/output.ts";
import { type OutputService, OutputServiceDIToken } from "../../../services/output/common/outputService.ts";
import { type TerminalService, TerminalServiceDIToken } from "../../terminal/browser/terminalService.ts";
import { type DefaultShellResolver, DefaultShellResolverDIToken } from "../../terminal/common/defaultShell.ts";
import type { IExtensionPtyTerminals } from "../../terminal/common/extensionPtyTerminals.ts";
import {
    createCustomizedTask,
    currentTaskPlatform,
    parseTasksJson,
    type TaskPlatform,
} from "../common/taskConfiguration.ts";
import { compareTasks, type IConfiguringTask, type ITask, taskMatches } from "../common/tasks.ts";

import {
    type ITaskEvent,
    type ITaskExecuteResult,
    type ITaskRunContext,
    type ITaskSummary,
    TerminalTaskSystem,
} from "./terminalTaskSystem.ts";

export type { ITaskEvent, ITaskSummary } from "./terminalTaskSystem.ts";

/** Сбой и пустой ответ провайдера ядро переживает — его задач просто нет. */
export interface ITaskProvider {
    provideTasks(): Promise<readonly ITask[]>;
}

export interface ITaskFilter {
    readonly type?: string;
}

export interface ITaskQuickPickEntry extends QuickPickItem {
    readonly task?: ITask;
    readonly id?: string;
}

/** `raceTimeout(…, 5000)` эталона. */
export const TASK_PROVIDER_TIMEOUT_MS = 5000;

export const TASKS_JSON_PATH = workspaceConfigFilePath("tasks.json");

export const TaskServiceDIToken = token<TaskService>("TaskService");

const TASKS_LOG_CHANNEL = "tasks";

export interface IWorkspaceTaskConfiguration {
    readonly tasks: readonly ITask[];
    readonly configuring: readonly IConfiguringTask[];
}

const NO_WORKSPACE_TASKS: IWorkspaceTaskConfiguration = { tasks: [], configuring: [] };

/** Ставит мост extension host'а; `undefined` — провайдеры всех типов. */
export type TaskProviderActivator = (type: string | undefined) => Promise<void>;

async function raceTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void): Promise<T | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<undefined>((resolve) => {
        timer = setTimeout(() => {
            onTimeout();
            resolve(undefined);
        }, ms);
    });
    try {
        return await Promise.race([promise, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

export class TaskService extends Disposable {
    public static dependencies = [
        TerminalServiceDIToken,
        ViewsServiceDIToken,
        DefaultShellResolverDIToken,
        IConfigurationServiceDIToken,
        IWorkspaceContextServiceDIToken,
        IFileServiceDIToken,
        EditorServiceDIToken,
        DialogServiceDIToken,
        NotificationServiceDIToken,
        QuickInputServiceDIToken,
        ContextKeyServiceDIToken,
        ILogServiceDIToken,
        OutputServiceDIToken,
    ] as const;

    private readonly system: TerminalTaskSystem;
    private readonly logger: ILogger;
    /** Ключ — провайдер: на тип их может быть несколько. */
    private readonly providers = new Map<ITaskProvider, string>();
    private readonly definitions = new Map<string, ITaskDefinitionSchema>();
    // Stryker disable next-line ArrowFunction: эквивалентный — гонка с таймаутом одинаково ждёт и undefined, и пустой промис
    private activator: TaskProviderActivator = () => Promise.resolve();
    /** Текст tasks.json и известные типы, о проблемах которых уже сказано в лог. */
    private reportedTasksJson: string | undefined;
    private readonly reportedUnmatched = new Set<string>();
    private readonly platform: TaskPlatform = currentTaskPlatform();

    public readonly onDidStateChange: Event<ITaskEvent>;
    private readonly onDidChangeDefinitionsEmitter = this.register(new Emitter<void>());

    public constructor(
        terminalService: TerminalService,
        private readonly views: ViewsService,
        defaultShell: DefaultShellResolver,
        private readonly configuration: IConfigurationService,
        private readonly workspace: IWorkspaceContextService,
        private readonly files: IFileService,
        private readonly editors: IEditorService,
        private readonly dialogs: DialogService,
        private readonly notifications: NotificationService,
        private readonly quickInput: QuickInputService,
        private readonly contextKeys: ContextKeyService,
        logService: ILogService,
        private readonly output: OutputService,
    ) {
        super();
        // Stryker disable next-line StringLiteral,ObjectLiteral: имя и подпись канала лога — проводка; канал «Tasks» виден в e2e-сценарии tasks
        this.logger = logService.createLogger(TASKS_LOG_CHANNEL, { label: "Tasks" });
        this.system = this.register(new TerminalTaskSystem(terminalService, views, defaultShell));
        this.onDidStateChange = this.system.onDidStateChange;
        this.register(
            this.onDidStateChange((event) => {
                if (this.configuration.get("task.verboseLogging")) this.logger.info(`Task Event kind: ${event.kind}`);
            }),
        );
        // На самом переходе, а не опросом на следующем нажатии: when-условия видят ключ сразу.
        this.register(
            this.onDidStateChange(() => {
                this.contextKeys.set("taskRunning", this.system.getActiveTasks().length > 0);
            }),
        );
    }

    public registerTaskProvider(provider: ITaskProvider, type: string): IDisposable {
        this.providers.set(provider, type);
        return {
            dispose: () => {
                this.providers.delete(provider);
            },
        };
    }

    /** Повтор типа — последний побеждает. */
    public registerTaskDefinitions(definitions: readonly ITaskDefinitionSchema[]): void {
        for (const definition of definitions) this.definitions.set(definition.taskType, definition);
        this.onDidChangeDefinitionsEmitter.fire();
    }

    public readonly onDidChangeDefinitions = this.onDidChangeDefinitionsEmitter.event;

    /** Без учёта `when`. */
    public taskDefinitionTypes(): string[] {
        return [...this.definitions.keys()];
    }

    public getTaskDefinition(type: string): ITaskDefinitionSchema | undefined {
        return this.definitions.get(type);
    }

    public setProviderActivator(activator: TaskProviderActivator): IDisposable {
        this.activator = activator;
        return {
            dispose: () => {
                // Stryker disable next-line ArrowFunction: эквивалентный — см. поле activator
                if (this.activator === activator) this.activator = () => Promise.resolve();
            },
        };
    }

    public setCustomExecutionTerminals(terminals: IExtensionPtyTerminals): IDisposable {
        this.system.setCustomExecutionTerminals(terminals);
        return {
            dispose: () => {
                this.system.setCustomExecutionTerminals(undefined);
            },
        };
    }

    /** Второй уровень пикера Run Task: типы с выполненным `when`; при `task.autoDetect: off` — ни одного. */
    public taskTypes(): string[] {
        if (!this.isProvideTasksEnabled()) return [];
        return [...this.definitions.values()]
            .filter((definition) => this.isTaskTypeEnabled(definition))
            .map((definition) => definition.taskType);
    }

    /** Первой папки (мультирута нет); перечитываются на каждом запросе. */
    public async getWorkspaceTasks(): Promise<readonly ITask[]> {
        return (await this.getWorkspaceConfiguration()).tasks;
    }

    public async getWorkspaceConfiguration(): Promise<IWorkspaceTaskConfiguration> {
        const folder = this.folder();
        // Stryker disable next-line ConditionalExpression: эквивалентный — без папки чтение ниже падает в catch и даёт тот же пустой список
        if (folder === undefined) return NO_WORKSPACE_TASKS;
        let text: string;
        try {
            const content = await this.files.readFile(Uri.joinPath(folder.uri, TASKS_JSON_PATH));
            text = new TextDecoder().decode(content.value);
        } catch {
            return NO_WORKSPACE_TASKS;
        }
        const { tasks, configuring, problems } = parseTasksJson(text, folder, this.platform, (type) =>
            this.definitions.get(type),
        );
        // Тип провайдера мог появиться после прошлого чтения — тогда сказать заново.
        const reportKey = JSON.stringify([text, this.taskDefinitionTypes()]);
        if (reportKey !== this.reportedTasksJson) {
            this.reportedTasksJson = reportKey;
            for (const problem of problems) this.logger.warn(problem);
            // Ошибки (не предупреждения) — ещё и тостом (`_showOutput` эталона).
            if (problems.some((problem) => problem.startsWith("Error:"))) this.promptToShowOutput();
        }
        return { tasks, configuring };
    }

    public tasksJsonUri(): Uri | undefined {
        const folder = this.folder();
        return folder === undefined ? undefined : Uri.joinPath(folder.uri, TASKS_JSON_PATH);
    }

    /** С фильтром — только задачи провайдеров типа; каждого ждут не дольше {@link TASK_PROVIDER_TIMEOUT_MS}. */
    public async tasks(filter: ITaskFilter = {}): Promise<ITask[]> {
        const all = await this.groupedTasks(filter.type);
        return filter.type === undefined
            ? all
            : all.filter((task) => task.source.kind === "extension" && task.type === filter.type);
    }

    /**
     * Среди них Run Task ищет задачу по аргументу. Кастомизированная задача
     * провайдера приходит слитой с записью; запись без задачи — ошибкой в лог
     * (`resolveTask` провайдера не спрашиваем).
     */
    public async groupedTasks(type?: string): Promise<ITask[]> {
        const [workspace, contributed] = await Promise.all([
            this.getWorkspaceConfiguration(),
            this.contributedTasks(type),
        ]);
        // По ключу определения, а не по id: id задачи с `CustomExecution` даёт само расширение.
        const byKey = new Map(workspace.configuring.map((configuring) => [configuring.configures._key, configuring]));
        const merged = contributed.map((task) => {
            const configuring = byKey.get(task.definition._key);
            if (configuring === undefined) return task;
            byKey.delete(task.definition._key);
            return createCustomizedTask(task, configuring);
        });
        for (const unmatched of byKey.values()) {
            if (type === undefined || unmatched.type === type) this.reportUnmatched(unmatched);
        }
        return [...workspace.tasks, ...merged];
    }

    public async resolveConfiguringTask(configuring: IConfiguringTask): Promise<ITask | undefined> {
        return (await this.groupedTasks(configuring.type)).find(
            // Индекс записи у задачи — только у задачи из этой записи (свои задачи стоят на других индексах).
            (task) => task.configIndex === configuring.configIndex,
        );
    }

    private reportUnmatched(configuring: IConfiguringTask): void {
        const element = JSON.stringify(configuring.element, undefined, 4);
        const key = JSON.stringify([configuring._id, element]);
        if (this.reportedUnmatched.has(key)) return;
        this.reportedUnmatched.add(key);
        // `task.autoDetect: off` — задач типа нет вовсе (текст эталона).
        this.logger.warn(
            this.isProvideTasksEnabled()
                ? `Error: The ${configuring.type} task detection didn't contribute a task for the following configuration:\n${element}\nThe task will be ignored.`
                : `Warning: ${configuring.type} tasks are unavailable in the current environment.`,
        );
    }

    public getActiveTasks(): readonly ITask[] {
        return this.system.getActiveTasks();
    }

    public async getTaskById(id: string): Promise<ITask | undefined> {
        return (await this.tasks()).find((task) => task._id === id);
    }

    private async contributedTasks(type: string | undefined): Promise<ITask[]> {
        await this.activateProviders(type);
        if (!this.isProvideTasksEnabled()) return [];
        const sets = await Promise.all(
            [...this.providers]
                .filter(([, providerType]) => type === undefined || type === providerType)
                .filter(([, providerType]) => {
                    const definition = this.definitions.get(providerType);
                    return definition === undefined || this.isTaskTypeEnabled(definition);
                })
                .map(([provider, providerType]) => this.provideTasks(provider, providerType)),
        );
        return sets.flat();
    }

    private async provideTasks(provider: ITaskProvider, type: string): Promise<readonly ITask[]> {
        try {
            const tasks = await raceTimeout(provider.provideTasks(), TASK_PROVIDER_TIMEOUT_MS, () => {
                this.logger.warn(`Timed out waiting for the task provider for "${type}" tasks.`);
            });
            for (const task of tasks ?? []) {
                if (task.type !== type) {
                    this.logger.warn(
                        `The task provider for "${type}" tasks unexpectedly provided a task of type "${task.type}".`,
                    );
                    break;
                }
            }
            return tasks ?? [];
        } catch (error) {
            this.logger.warn(`Error: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }

    private async activateProviders(type: string | undefined): Promise<void> {
        await raceTimeout(this.activator(type), TASK_PROVIDER_TIMEOUT_MS, () => {
            this.logger.warn("Timed out activating extensions for task providers");
        });
    }

    private isProvideTasksEnabled(): boolean {
        return this.configuration.get("task.autoDetect") === "on";
    }

    private isTaskTypeEnabled(definition: ITaskDefinitionSchema): boolean {
        return definition.when === undefined || this.contextKeys.evaluate(definition.when);
    }

    /** Уже бегущая — по её `instancePolicy`. Отказ — сообщение человеку и в лог, обещание отклоняется. */
    public async run(task: ITask): Promise<ITaskSummary | undefined> {
        try {
            await this.saveBeforeRun();
            return await this.handleExecuteResult(this.system.run(task, this.runContext()));
        } catch (error) {
            this.handleError(error);
            throw error;
        }
    }

    /** Редакторы сохраняются всегда, как у эталона; повторять нечего — открыть Run Task. */
    public async rerun(openRunTask: () => Promise<void>): Promise<void> {
        await this.editors.saveAll();
        let result: ITaskExecuteResult | undefined;
        try {
            result = this.system.rerun(this.runContext());
        } catch (error) {
            this.handleError(error);
            return;
        }
        if (result !== undefined) {
            void this.handleExecuteResult(result).catch(() => undefined);
            return;
        }
        // Бегущая задача всегда оставляет «последнюю» — сюда доходят, только когда не бежит ничего.
        await openRunTask();
    }

    /** Задачу tasks.json — в нынешнем виде: файл могли поправить. */
    public async restart(task: ITask): Promise<void> {
        // Терминал закрывается всегда: отказа остановки, как у эталона с ненайденным процессом, у нас нет.
        await this.system.terminate(task);
        // Id задач tasks.json (`$core.…`) с задачами провайдеров не пересекаются.
        const updated = (await this.getWorkspaceTasks()).find((candidate) => candidate._id === task._id);
        // Конца задачи не ждём: перезапуск закончен, когда она снова запущена.
        void this.run(updated ?? task).catch(() => undefined);
    }

    public terminate(task: ITask): Promise<boolean> {
        return this.system.terminate(task);
    }

    public terminateAll(): Promise<void> {
        return this.system.terminateAll();
    }

    public revealTask(task: ITask): boolean {
        return this.system.revealTask(task);
    }

    /** Аргумент команды — строка-подпись или определение задачи. */
    public taskIdentifierOf(arg: unknown): string | IKeyedTaskIdentifier | undefined {
        if (typeof arg === "string") return arg;
        if (typeof arg !== "object" || arg === null || typeof (arg as { type?: unknown }).type !== "string") {
            return undefined;
        }
        const identifier = arg as ITaskIdentifier;
        return createTaskIdentifier(identifier, this.definitions.get(identifier.type), (message) => {
            this.logger.warn(message);
        });
    }

    public findTask(tasks: readonly ITask[], identifier: string | IKeyedTaskIdentifier): ITask | undefined {
        return tasks.find((task) => taskMatches(task, identifier));
    }

    /**
     * При одной строке и `task.quickOpen.skip` — без показа; пусто — `defaultEntry`;
     * `additional` — в конце, если строк больше одной. `undefined` — отмена.
     */
    public async pickTask(
        tasks: readonly ITask[],
        placeholder: string,
        defaultEntry: ITaskQuickPickEntry,
        additional?: ITaskQuickPickEntry,
    ): Promise<ITaskQuickPickEntry | undefined> {
        const entries: ITaskQuickPickEntry[] = this.taskEntries([...tasks].sort(compareTasks));
        if (entries.length === 1 && this.configuration.get("task.quickOpen.skip")) return entries[0];
        if (entries.length === 0) entries.push(defaultEntry);
        else if (entries.length > 1 && additional !== undefined) entries.push(additional);
        return (await this.quickInput.quickPick({ placeholder, items: entries })) as ITaskQuickPickEntry | undefined;
    }

    /** Задачи с одним id получают номера « (1)», « (2)», как у эталона. */
    public taskEntries(tasks: readonly ITask[]): ITaskQuickPickEntry[] {
        const counts = new Map<string, number>();
        for (const task of tasks) counts.set(task._id, (counts.get(task._id) ?? 0) + 1);
        const numbers = new Map<string, number>();
        return tasks.map((task) => {
            const base = this.taskEntryBase(task);
            if (counts.get(task._id) === 1) return { ...base, task };
            const n = (numbers.get(task._id) ?? 0) + 1;
            numbers.set(task._id, n);
            return { ...base, label: `${base.label} (${String(n)})`, task };
        });
    }

    /** Второй строки у пикера нет — `detail` идёт в описание: папки без мультирута там не бывает. */
    public taskEntryBase(task: ITask): QuickPickItem {
        const detail = this.configuration.get("task.quickOpen.detail") ? task.detail : undefined;
        return { label: task._label, ...(detail !== undefined ? { description: detail } : {}) };
    }

    /** Одна задача или одна группа — сразу её терминал, иначе пикер. */
    public async showRunningTasks(): Promise<void> {
        const active = this.getActiveTasks();
        const group = active.at(0)?.command.presentation.group;
        if (
            active.length === 1 ||
            // Stryker disable next-line EqualityOperator,ConditionalExpression: эквивалентный — без задач нет и группы (`>= 0` и пропуск проверки дают то же)
            (active.length > 0 && group !== undefined && active.every((t) => t.command.presentation.group === group))
        ) {
            this.revealTask(active[0]);
            return;
        }
        const entry = await this.pickTask(active, "Select the task to show its output", {
            label: "No task is running",
        });
        if (entry?.task !== undefined) this.revealTask(entry.task);
    }

    private async handleExecuteResult(result: ITaskExecuteResult): Promise<ITaskSummary | undefined> {
        if (result.kind === "active") {
            this.handleInstancePolicy(result.task);
        }
        return result.promise;
    }

    private handleInstancePolicy(task: ITask): void {
        // Stryker disable next-line ConditionalExpression: эквивалентный — показ видимой задачи ничего не меняет; проверка — как у эталона
        if (!this.system.isTaskVisible(task)) this.system.revealTask(task);
        switch (task.runOptions.instancePolicy) {
            case "terminateNewest":
            case "terminateOldest":
                void this.restart(task);
                return;
            // Stryker disable next-line ConditionalExpression,StringLiteral: эквивалентный — без этой ветки switch тоже ничего не делает; ветка — для читателя
            case "silent":
                return;
            case "warn":
                this.notifications.show({
                    severity: "warn",
                    message: "The instance limit for this task has been reached.",
                    modal: false,
                    items: [],
                });
                return;
            case "prompt":
                this.promptInstanceToTerminate(task).catch((error: unknown) => {
                    this.handleError(error);
                });
                return;
        }
    }

    private async promptInstanceToTerminate(task: ITask): Promise<void> {
        const instances = this.getActiveTasks().filter((t) => t._id === task._id);
        // Stryker disable ObjectLiteral,StringLiteral: строка «пусто» недостижима — среди копий всегда есть сама бегущая задача (текст эталона)
        const entry = await this.pickTask(instances, "Select an instance to terminate", {
            label: "No instance is currently running",
        });
        // Stryker restore ObjectLiteral,StringLiteral
        if (entry?.task !== undefined) await this.restart(entry.task);
    }

    private async saveBeforeRun(): Promise<void> {
        const mode = this.configuration.get("task.saveBeforeRun");
        if (mode === "never") return;
        if (mode === "prompt" && this.editors.collectDirty().length > 0) {
            const confirmed = await this.dialogs.confirm({
                title: "Save all editors?",
                message: "Do you want to save all editors before running the task?",
                confirmLabel: "Save",
                cancelLabel: "Don't Save",
                defaultButton: "confirm",
            });
            if (!confirmed) return;
        }
        await this.editors.saveAll();
    }

    private runContext(): ITaskRunContext {
        const folder = this.folder();
        const editor = this.editors.getActiveTabEditor();
        const file = editor?.uri.scheme === "file" ? editor : undefined;
        return {
            platform: this.platform,
            variables: {
                folderPath: folder?.uri.fsPath,
                filePath: file?.uri.fsPath,
                lineNumber: file === undefined ? undefined : file.primaryCursorLine + 1,
                env: process.env,
                userHome: process.env.HOME ?? process.env.USERPROFILE,
                cwd: process.cwd(),
                getConfiguration: (key) => this.configuration.get(key),
            },
        };
    }

    private folder(): IWorkspaceFolder | undefined {
        return this.workspace.getWorkspace().folders.at(0);
    }

    private handleError(error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(message);
        this.notifications.show({ severity: "error", message, modal: false, items: [] });
    }

    private promptToShowOutput(): void {
        void this.notifications
            .show({
                severity: "warn",
                message: "There are task errors. See the output for details.",
                modal: false,
                items: ["Show Output"],
            })
            .answered.then((index) => {
                if (index !== 0) return;
                this.views.openView(OUTPUT_VIEW_ID, false, false);
                this.output.showChannel(TASKS_LOG_CHANNEL);
            });
    }
}
