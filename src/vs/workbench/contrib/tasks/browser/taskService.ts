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
import { TerminalEditorServiceDIToken } from "../../terminal/browser/terminalEditorService.ts";
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
    type ITaskEditorTerminals,
    type ITaskEvent,
    type ITaskExecuteResult,
    type ITaskRunContext,
    type ITaskSummary,
    TerminalTaskSystem,
} from "./terminalTaskSystem.ts";

export type { ITaskEvent, ITaskSummary } from "./terminalTaskSystem.ts";

/** The core survives a provider failure or empty answer: the provider just has no tasks. */
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

/** Upstream's `raceTimeout(…, 5000)`. */
export const TASK_PROVIDER_TIMEOUT_MS = 5000;

export const TASKS_JSON_PATH = workspaceConfigFilePath("tasks.json");

export const TaskServiceDIToken = token<TaskService>("TaskService");

const TASKS_LOG_CHANNEL = "tasks";

export interface IWorkspaceTaskConfiguration {
    readonly tasks: readonly ITask[];
    readonly configuring: readonly IConfiguringTask[];
}

const NO_WORKSPACE_TASKS: IWorkspaceTaskConfiguration = { tasks: [], configuring: [] };

/** Installs the extension host bridge; `undefined` means providers of all types. */
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
        TerminalEditorServiceDIToken,
    ] as const;

    private readonly system: TerminalTaskSystem;
    private readonly logger: ILogger;
    /** Keyed by provider: a type may have several. */
    private readonly providers = new Map<ITaskProvider, string>();
    private readonly definitions = new Map<string, ITaskDefinitionSchema>();
    // Stryker disable next-line ArrowFunction: equivalent: the timeout race awaits undefined and an empty promise alike
    private activator: TaskProviderActivator = () => Promise.resolve();
    /** tasks.json text and known types whose problems were already logged. */
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
        editorTerminals: ITaskEditorTerminals,
    ) {
        super();
        // Stryker disable next-line StringLiteral,ObjectLiteral: log channel name and label are wiring; the e2e tasks scenario sees "Tasks"
        this.logger = logService.createLogger(TASKS_LOG_CHANNEL, { label: "Tasks" });
        this.system = this.register(new TerminalTaskSystem(terminalService, views, defaultShell, editorTerminals));
        this.onDidStateChange = this.system.onDidStateChange;
        this.register(
            this.onDidStateChange((event) => {
                if (this.configuration.get("task.verboseLogging")) this.logger.info(`Task Event kind: ${event.kind}`);
            }),
        );
        // On the transition itself rather than polling on the next keypress: when clauses see the key immediately.
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

    /** A repeated type: the last one wins. */
    public registerTaskDefinitions(definitions: readonly ITaskDefinitionSchema[]): void {
        for (const definition of definitions) this.definitions.set(definition.taskType, definition);
        this.onDidChangeDefinitionsEmitter.fire();
    }

    public readonly onDidChangeDefinitions = this.onDidChangeDefinitionsEmitter.event;

    /** Ignores `when`. */
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
                // Stryker disable next-line ArrowFunction: equivalent: see the activator field
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

    /** Second level of the Run Task picker: types whose `when` holds; none with `task.autoDetect: off`. */
    public taskTypes(): string[] {
        if (!this.isProvideTasksEnabled()) return [];
        return [...this.definitions.values()]
            .filter((definition) => this.isTaskTypeEnabled(definition))
            .map((definition) => definition.taskType);
    }

    /** Of the first folder (no multi-root); reread on every request. */
    public async getWorkspaceTasks(): Promise<readonly ITask[]> {
        return (await this.getWorkspaceConfiguration()).tasks;
    }

    public async getWorkspaceConfiguration(): Promise<IWorkspaceTaskConfiguration> {
        const folder = this.folder();
        // Stryker disable next-line ConditionalExpression: equivalent: without a folder the read below hits catch and gives the same empty list
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
        // A provider type may have appeared since the last read; report again then.
        const reportKey = JSON.stringify([text, this.taskDefinitionTypes()]);
        if (reportKey !== this.reportedTasksJson) {
            this.reportedTasksJson = reportKey;
            for (const problem of problems) this.logger.warn(problem);
            // Errors (not warnings) also get a toast (upstream's `_showOutput`).
            if (problems.some((problem) => problem.startsWith("Error:"))) this.promptToShowOutput();
        }
        return { tasks, configuring };
    }

    public tasksJsonUri(): Uri | undefined {
        const folder = this.folder();
        return folder === undefined ? undefined : Uri.joinPath(folder.uri, TASKS_JSON_PATH);
    }

    /** With a filter, only tasks of that type's providers; each is awaited at most {@link TASK_PROVIDER_TIMEOUT_MS}. */
    public async tasks(filter: ITaskFilter = {}): Promise<ITask[]> {
        const all = await this.groupedTasks(filter.type);
        return filter.type === undefined
            ? all
            : all.filter((task) => task.source.kind === "extension" && task.type === filter.type);
    }

    /**
     * Run Task looks up the task for its argument among these. A customized provider
     * task arrives merged with its entry; an entry without a task is logged as an error
     * (the provider's `resolveTask` is not asked).
     */
    public async groupedTasks(type?: string): Promise<ITask[]> {
        const [workspace, contributed] = await Promise.all([
            this.getWorkspaceConfiguration(),
            this.contributedTasks(type),
        ]);
        // By definition key, not by id: the extension itself sets the id of a `CustomExecution` task.
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
            // Only the task from this entry carries its entry index (configured tasks sit at other indexes).
            (task) => task.configIndex === configuring.configIndex,
        );
    }

    private reportUnmatched(configuring: IConfiguringTask): void {
        const element = JSON.stringify(configuring.element, undefined, 4);
        const key = JSON.stringify([configuring._id, element]);
        if (this.reportedUnmatched.has(key)) return;
        this.reportedUnmatched.add(key);
        // With `task.autoDetect: off` the type has no tasks at all (upstream text).
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

    /**
     * An already running task follows its `instancePolicy`. A refusal is shown to the user and logged;
     * the promise rejects.
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

    /** Editors are always saved, as upstream; with nothing to rerun, open Run Task. */
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
        // A running task always leaves a "last" one; we get here only when nothing is running.
        await openRunTask();
    }

    /** A tasks.json task is rerun in its current form: the file may have been edited. */
    public async restart(task: ITask): Promise<void> {
        // The terminal always closes: we have no termination refusal like upstream's process-not-found case.
        await this.system.terminate(task);
        // tasks.json task ids (`$core.…`) do not collide with provider tasks.
        const updated = (await this.getWorkspaceTasks()).find((candidate) => candidate._id === task._id);
        // The task end is not awaited: the restart is done once the task runs again.
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

    /** The command argument is a label string or a task definition. */
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
     * With a single entry and `task.quickOpen.skip`, no picker is shown; when empty, `defaultEntry`;
     * `additional` goes last when there is more than one entry. `undefined` means cancel.
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

    /** Tasks sharing an id get numbers " (1)", " (2)", as upstream. */
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

    /** The picker has no second line, so `detail` goes into the description: without multi-root it never holds a folder. */
    public taskEntryBase(task: ITask): QuickPickItem {
        const detail = this.configuration.get("task.quickOpen.detail") ? task.detail : undefined;
        return { label: task._label, ...(detail !== undefined ? { description: detail } : {}) };
    }

    /** A single task or a single group reveals its terminal directly, otherwise a picker. */
    public async showRunningTasks(): Promise<void> {
        const active = this.getActiveTasks();
        const group = active.at(0)?.command.presentation.group;
        if (
            active.length === 1 ||
            // Stryker disable next-line EqualityOperator,ConditionalExpression: equivalent: no tasks means no group (`>= 0` or no check act the same)
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
        // Stryker disable next-line ConditionalExpression: equivalent: revealing a visible task changes nothing; the check is as upstream
        if (!this.system.isTaskVisible(task)) this.system.revealTask(task);
        switch (task.runOptions.instancePolicy) {
            case "terminateNewest":
            case "terminateOldest":
                void this.restart(task);
                return;
            // Stryker disable next-line ConditionalExpression,StringLiteral: equivalent: without this case the switch does nothing too; it is for the reader
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
        // Stryker disable ObjectLiteral,StringLiteral: the "empty" entry (upstream text) is unreachable:
        // the running task itself is always among the instances.
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
