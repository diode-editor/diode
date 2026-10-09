// Сервис задач (`abstractTaskService.ts` эталона в объёме первой итерации):
// задачи из `.diode/tasks.json` и от провайдеров расширений, запуск через
// {@link TerminalTaskSystem}, Rerun / Restart / Terminate / Show Running,
// политика повторного запуска (`instancePolicy`), `task.saveBeforeRun`,
// активация провайдеров (`onTaskType:`) и ключ `taskRunning`.
// Пикеры — `taskQuickPick.ts`, команды — `taskActions.ts`.

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
import { type PanelService, PanelServiceDIToken } from "../../../browser/parts/panel/panelService.ts";
import {
    type QuickInputService,
    QuickInputServiceDIToken,
} from "../../../browser/parts/quickinput/quickInputService.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";
import { type DialogService, DialogServiceDIToken } from "../../../services/dialogs/browser/dialogService.ts";
import { EditorServiceDIToken, type IEditorService } from "../../../services/editor/common/editorService.ts";
import { type LayoutService, LayoutServiceDIToken } from "../../../services/layout/browser/layoutService.ts";
import {
    type NotificationService,
    NotificationServiceDIToken,
} from "../../../services/notification/browser/notificationService.ts";
import { OUTPUT_VIEW_ID } from "../../../services/output/common/output.ts";
import { type OutputService, OutputServiceDIToken } from "../../../services/output/common/outputService.ts";
import { type TerminalService, TerminalServiceDIToken } from "../../terminal/browser/terminalService.ts";
import { type DefaultShellResolver, DefaultShellResolverDIToken } from "../../terminal/common/defaultShell.ts";
import type { IExtensionPtyTerminals } from "../../terminal/common/extensionPtyTerminals.ts";
import { currentTaskPlatform, parseTasksJson, type TaskPlatform } from "../common/taskConfiguration.ts";
import { compareTasks, type ITask, taskMatches } from "../common/tasks.ts";

import {
    type ITaskEvent,
    type ITaskExecuteResult,
    type ITaskRunContext,
    type ITaskSummary,
    TerminalTaskSystem,
} from "./terminalTaskSystem.ts";

export type { ITaskEvent, ITaskSummary } from "./terminalTaskSystem.ts";

/**
 * Провайдер задач расширения (`ITaskProvider` эталона): задачи одного типа.
 * Сбой и пустой ответ ядро переживает — задач провайдера просто нет.
 */
export interface ITaskProvider {
    provideTasks(): Promise<readonly ITask[]>;
}

/** Фильтр задач (`ITaskFilter`): только задачи провайдеров этого типа. */
export interface ITaskFilter {
    readonly type?: string;
}

/** Строка пикера задач: пункт с задачей (или без — «нет задач», «все бегущие»). */
export interface ITaskQuickPickEntry extends QuickPickItem {
    readonly task?: ITask;
    readonly id?: string;
}

/** Сколько ждать провайдера и активации расширений (`raceTimeout(…, 5000)` эталона). */
export const TASK_PROVIDER_TIMEOUT_MS = 5000;

/** Где лежит конфигурация задач папки — как у эталона (Diode её только читает). */
/** tasks.json проекта относительно папки (у эталона — `.vscode/tasks.json`). */
export const TASKS_JSON_PATH = workspaceConfigFilePath("tasks.json");

export const TaskServiceDIToken = token<TaskService>("TaskService");

/** Канал лога задач (панель Output, «Tasks»). */
const TASKS_LOG_CHANNEL = "tasks";

/**
 * Активатор провайдеров: поднять расширения, которые дают задачи типа (или
 * всех типов, если тип не задан). Ставит мост extension host'а.
 */
export type TaskProviderActivator = (type: string | undefined) => Promise<void>;

/** Разрешение ждать обещание не дольше `ms`: по истечении — `undefined`. */
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
        PanelServiceDIToken,
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
        LayoutServiceDIToken,
    ] as const;

    private readonly system: TerminalTaskSystem;
    private readonly logger: ILogger;
    /** Провайдеры по типу; на тип их может быть несколько (разные расширения). */
    private readonly providers = new Map<ITaskProvider, string>();
    /** Типы из `contributes.taskDefinitions` по имени типа. */
    private readonly definitions = new Map<string, ITaskDefinitionSchema>();
    // Stryker disable next-line ArrowFunction: эквивалентный — гонка с таймаутом одинаково ждёт и undefined, и пустой промис
    private activator: TaskProviderActivator = () => Promise.resolve();
    /** Текст tasks.json, о проблемах которого уже сказано в лог. */
    private reportedTasksJson: string | undefined;
    private readonly platform: TaskPlatform = currentTaskPlatform();

    public readonly onDidStateChange: Event<ITaskEvent>;
    private readonly onDidChangeDefinitionsEmitter = this.register(new Emitter<void>());

    public constructor(
        terminalService: TerminalService,
        private readonly panel: PanelService,
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
        private readonly layout: LayoutService,
    ) {
        super();
        // Stryker disable next-line StringLiteral,ObjectLiteral: имя и подпись канала лога — проводка; канал «Tasks» виден в e2e-сценарии tasks
        this.logger = logService.createLogger(TASKS_LOG_CHANNEL, { label: "Tasks" });
        this.system = this.register(new TerminalTaskSystem(terminalService, panel, defaultShell));
        this.onDidStateChange = this.system.onDidStateChange;
        // `task.verboseLogging` — каждое событие задачи в лог `Tasks` (`_log(…, true)` эталона).
        this.register(
            this.onDidStateChange((event) => {
                if (this.configuration.get("task.verboseLogging")) this.logger.info(`Task Event kind: ${event.kind}`);
            }),
        );
        // `taskRunning` (`TASK_RUNNING_STATE` эталона) выставляется на самом
        // переходе, а не опросом на следующем нажатии: when-условия видят его сразу
        // (до первой задачи ключа нет — он ложен).
        this.register(
            this.onDidStateChange(() => {
                this.contextKeys.set("taskRunning", this.system.getActiveTasks().length > 0);
            }),
        );
    }

    // ── Провайдеры и типы (их приносит мост extension host'а) ─────────────────

    /** Зарегистрировать провайдера задач типа `type` (`registerTaskProvider`). */
    public registerTaskProvider(provider: ITaskProvider, type: string): IDisposable {
        this.providers.set(provider, type);
        return {
            dispose: () => {
                this.providers.delete(provider);
            },
        };
    }

    /** Типы задач расширений (`contributes.taskDefinitions`); повтор типа — последний побеждает. */
    public registerTaskDefinitions(definitions: readonly ITaskDefinitionSchema[]): void {
        for (const definition of definitions) this.definitions.set(definition.taskType, definition);
        this.onDidChangeDefinitionsEmitter.fire();
    }

    public readonly onDidChangeDefinitions = this.onDidChangeDefinitionsEmitter.event;

    /** Все известные типы задач (`TaskDefinitionRegistry.all()`), без учёта `when`. */
    public taskDefinitionTypes(): string[] {
        return [...this.definitions.keys()];
    }

    public getTaskDefinition(type: string): ITaskDefinitionSchema | undefined {
        return this.definitions.get(type);
    }

    /** Как поднимать провайдеров (`_activateTaskProviders`) — ставит мост extension host'а. */
    public setProviderActivator(activator: TaskProviderActivator): IDisposable {
        this.activator = activator;
        return {
            dispose: () => {
                // Stryker disable next-line ArrowFunction: эквивалентный — см. поле activator
                if (this.activator === activator) this.activator = () => Promise.resolve();
            },
        };
    }

    /** Мост pty расширений для задач с `CustomExecution`. */
    public setCustomExecutionTerminals(terminals: IExtensionPtyTerminals): IDisposable {
        this.system.setCustomExecutionTerminals(terminals);
        return {
            dispose: () => {
                this.system.setCustomExecutionTerminals(undefined);
            },
        };
    }

    /**
     * Типы, по которым пикер Run Task показывает второй уровень (`taskTypes`):
     * все из `taskDefinitions`, чьё `when` выполнено; при `task.autoDetect: off`
     * — ни одного.
     */
    public taskTypes(): string[] {
        if (!this.isProvideTasksEnabled()) return [];
        return [...this.definitions.values()]
            .filter((definition) => this.isTaskTypeEnabled(definition))
            .map((definition) => definition.taskType);
    }

    // ── Списки задач ─────────────────────────────────────────────────────────

    /** Задачи tasks.json первой папки (мультирута нет); перечитываются на каждом запросе. */
    public async getWorkspaceTasks(): Promise<readonly ITask[]> {
        const folder = this.folder();
        // Stryker disable next-line ConditionalExpression: эквивалентный — без папки чтение ниже падает в catch и даёт тот же пустой список
        if (folder === undefined) return [];
        let text: string;
        try {
            const content = await this.files.readFile(Uri.joinPath(folder.uri, TASKS_JSON_PATH));
            text = new TextDecoder().decode(content.value);
        } catch {
            return [];
        }
        const { tasks, problems } = parseTasksJson(text, folder, this.platform);
        if (text !== this.reportedTasksJson) {
            this.reportedTasksJson = text;
            for (const problem of problems) this.logger.warn(problem);
            // Ошибки (не предупреждения) человеку — тостом с переходом в лог (`_showOutput` эталона).
            if (problems.some((problem) => problem.startsWith("Error:"))) this.promptToShowOutput();
        }
        return tasks;
    }

    /**
     * Все задачи (`tasks(filter)` эталона): tasks.json и ответы провайдеров.
     * С фильтром по типу — только задачи провайдеров этого типа. Провайдеров
     * сперва поднимают (`onTaskType:`), каждого ждут не дольше
     * {@link TASK_PROVIDER_TIMEOUT_MS}.
     */
    public async tasks(filter: ITaskFilter = {}): Promise<ITask[]> {
        const all = await this.groupedTasks(filter.type);
        return filter.type === undefined
            ? all
            : all.filter((task) => task.source.kind === "extension" && task.type === filter.type);
    }

    /**
     * tasks.json и задачи провайдеров (только типа `type`, если он задан) без
     * фильтра (`_getGroupedTasks` эталона): среди них команда Run Task ищет
     * задачу по аргументу.
     */
    public async groupedTasks(type?: string): Promise<ITask[]> {
        const [workspace, contributed] = await Promise.all([this.getWorkspaceTasks(), this.contributedTasks(type)]);
        return [...workspace, ...contributed];
    }

    /** Бегущие задачи в порядке запуска. */
    public getActiveTasks(): readonly ITask[] {
        return this.system.getActiveTasks();
    }

    /** Задача по внутреннему id среди всех (`getTask` эталона для исполнения по handle). */
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

    // ── Запуск ───────────────────────────────────────────────────────────────

    /**
     * Запустить задачу (`run` эталона): сохранить редакторы по
     * `task.saveBeforeRun`, исполнить; уже бегущая — по её `instancePolicy`.
     * Отказ (переменная не подставилась, нечем исполнить) — сообщение
     * человеку и в лог, обещание отклоняется.
     */
    public async run(task: ITask): Promise<ITaskSummary | undefined> {
        try {
            await this.saveBeforeRun();
            return await this.handleExecuteResult(this.system.run(task, this.runContext()));
        } catch (error) {
            this.handleError(error);
            throw error;
        }
    }

    /**
     * Повторить последнюю задачу (`reRunTask`): редакторы сохраняются всегда,
     * как у эталона; повторять нечего и ничего не бежит — открыть Run Task.
     */
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

    /**
     * Перезапуск (`_restart`): бегущую остановить и запустить заново — задачу
     * tasks.json в её нынешнем виде (файл могли поправить), иначе ту же.
     */
    public async restart(task: ITask): Promise<void> {
        // Терминал бегущей задачи закрывается всегда — отказа остановки, как у
        // эталона с процессом, который не нашёлся, у нас нет.
        await this.system.terminate(task);
        // Id задач tasks.json (`$core.…`) с задачами провайдеров не пересекаются.
        const updated = (await this.getWorkspaceTasks()).find((candidate) => candidate._id === task._id);
        // Конца задачи не ждём: перезапуск закончен, когда она снова запущена.
        void this.run(updated ?? task).catch(() => undefined);
    }

    /** Остановить задачу; `false` — она не бежала. */
    public terminate(task: ITask): Promise<boolean> {
        return this.system.terminate(task);
    }

    public terminateAll(): Promise<void> {
        return this.system.terminateAll();
    }

    /** Показать терминал задачи. */
    public revealTask(task: ITask): boolean {
        return this.system.revealTask(task);
    }

    /** Аргумент команды (строка-подпись или определение) → то, с чем сравнивать задачи. */
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

    /** Среди задач — первая, подходящая под идентификатор. */
    public findTask(tasks: readonly ITask[], identifier: string | IKeyedTaskIdentifier): ITask | undefined {
        return tasks.find((task) => taskMatches(task, identifier));
    }

    /**
     * Пикер задач (`_showQuickPick` эталона): строки с подписью задачи (повтор
     * id — с номером), `task.quickOpen.skip` при одной строке — без показа;
     * пусто — строка `defaultEntry`; `additional` — в конце, если строк больше
     * одной. `undefined` — отмена.
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

    /** Строки пикера по задачам: задачи с одним id получают номера « (1)», « (2)» (как эталон). */
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

    /**
     * Подпись и подробность задачи в пикере. Второй строки у пикера нет, поэтому
     * `detail` (`task.quickOpen.detail`) идёт в описание строки — описания
     * (папки) у задачи без мультирута не бывает.
     */
    public taskEntryBase(task: ITask): QuickPickItem {
        const detail = this.configuration.get("task.quickOpen.detail") ? task.detail : undefined;
        return { label: task._label, ...(detail !== undefined ? { description: detail } : {}) };
    }

    /** Показать бегущие (`runShowTasks`): одна или одна группа — сразу её терминал, иначе пикер. */
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

    /** Повторный запуск бегущей задачи (`_handleInstancePolicy`). */
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

    /** `task.saveBeforeRun`: `never` — нет, `prompt` — спросить, если есть что сохранять. */
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

    /** Тост эталона об ошибках задач; «Show Output» — панель Output на канале `Tasks`. */
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
                this.panel.setActiveView(OUTPUT_VIEW_ID);
                this.layout.setPanelVisible(true);
                this.output.showChannel(TASKS_LOG_CHANNEL);
            });
    }
}
