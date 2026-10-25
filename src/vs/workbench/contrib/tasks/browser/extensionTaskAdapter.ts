import { DisposableStore, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { IWorkspaceContextService } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import type { IExtensionTaskEvents, IExtensionTaskSink } from "../../../api/common/iExtensionTaskSink.ts";
import { parseTaskDefinitions } from "../../../api/common/taskIdentity.ts";
import type {
    IWireTask,
    IWireTaskDefinition,
    IWireTaskExecution,
    WireTaskExecuteRequest,
} from "../../../api/common/taskWireTypes.ts";
import type { IExtensionService } from "../../../services/extensions/common/extensions.ts";
import type { IExtensionPtyTerminals } from "../../terminal/common/extensionPtyTerminals.ts";
import { type ITaskFromWireContext, taskFromWire, taskToWire } from "../common/taskDto.ts";
import type { ITask } from "../common/tasks.ts";

import type { TaskService } from "./taskService.ts";

/** Lifecycle events of the service's tasks go to extensions for every task, including ones run from the palette. */
export class ExtensionTaskAdapter implements IExtensionTaskSink {
    /** Also receives the end of a task that never started. */
    private events: IExtensionTaskEvents | null = null;

    public constructor(
        private readonly tasks: TaskService,
        private readonly workspace: IWorkspaceContextService,
        private readonly logger: ILogger,
    ) {}

    public subscribe(events: IExtensionTaskEvents): IDisposable {
        const store = new DisposableStore();
        this.events = events;
        store.add({
            dispose: () => {
                if (this.events === events) this.events = null;
            },
        });
        store.add(
            this.tasks.onDidStateChange((event) => {
                switch (event.kind) {
                    case "start":
                        events.started(
                            executionOf(event.task),
                            event.terminalId,
                            event.resolvedDefinition as IWireTaskDefinition,
                        );
                        return;
                    case "processStarted":
                        events.processStarted(event.task._id, event.processId);
                        return;
                    case "processEnded":
                        events.processEnded(event.task._id, event.exitCode);
                        return;
                    case "end":
                        events.ended(executionOf(event.task));
                        return;
                    // Stryker disable next-line ConditionalExpression: equivalent: the bridge needs no other events, the branch is empty
                    default:
                        return;
                }
            }),
        );
        return store;
    }

    public registerProvider(
        extensionId: string,
        type: string,
        provide: () => Promise<readonly IWireTask[]>,
    ): IDisposable {
        return this.tasks.registerTaskProvider(
            {
                provideTasks: async () =>
                    (await provide())
                        .map((wire) => taskFromWire(wire, this.context()))
                        .filter((task): task is ITask => {
                            if (task === undefined)
                                this.logger.warn(
                                    `Task System: a task of "${extensionId}" has no execution and is dropped.`,
                                );
                            return task !== undefined;
                        }),
            },
            type,
        );
    }

    public async fetch(type: string | undefined): Promise<IWireTask[]> {
        // Stryker disable next-line ConditionalExpression: equivalent: the service reads `{ type: undefined }` as "no type"
        return (await this.tasks.tasks(type === undefined ? {} : { type })).map(taskToWire);
    }

    /**
     * A task that never started still ends for the extension with an end event;
     * otherwise it would hang in `taskExecutions` forever (as upstream).
     */
    public async execute(request: WireTaskExecuteRequest): Promise<IWireTaskExecution> {
        const task =
            "id" in request ? await this.tasks.getTaskById(request.id) : taskFromWire(request.task, this.context());
        if (task === undefined) throw new Error("id" in request ? "Task not found" : "Task is not valid");
        const execution = executionOf(task);
        // `run` rejects only before start (the outcome of a started task does not reject).
        this.tasks.run(task).catch(() => {
            this.events?.ended(execution);
        });
        return execution;
    }

    public terminate(id: string): void {
        const task = this.tasks.getActiveTasks().find((candidate) => candidate._id === id);
        if (task !== undefined) void this.tasks.terminate(task);
    }

    private context(): ITaskFromWireContext {
        return {
            folders: this.workspace.getWorkspace().folders,
            schemaOf: (type) => this.tasks.getTaskDefinition(type),
            report: (message) => {
                this.logger.warn(message);
            },
        };
    }
}

function executionOf(task: ITask): IWireTaskExecution {
    return { id: task._id, task: taskToWire(task) };
}

/** Activation event upstream uses to wake providers before Run Task. */
export const RUN_TASK_ACTIVATION_EVENT = "onCommand:workbench.action.tasks.runTask";

/** Without a type, activation wakes providers of every known type. */
export function bindExtensionTasks(
    tasks: TaskService,
    extensions: IExtensionService,
    ptyTerminals: IExtensionPtyTerminals,
    logger: ILogger,
): IDisposable {
    const store = new DisposableStore();
    tasks.registerTaskDefinitions(
        extensions.extensions.flatMap((extension) =>
            parseTaskDefinitions(extension.id, extension.manifest.contributes?.taskDefinitions, (message) => {
                logger.warn(`${extension.id}: ${message}`);
            }),
        ),
    );
    // Static contributions of the manifests: no activation (upstream's `problemMatchersExtPoint`).
    tasks.registerProblemMatchers(extensions.extensions, (extension, message) => {
        logger.warn(`${extension.id}: ${message}`);
    });
    store.add(
        tasks.setProviderActivator(async (type) => {
            await extensions.whenInstalledExtensionsRegistered();
            const types = type === undefined ? tasks.taskDefinitionTypes() : [type];
            const events = [RUN_TASK_ACTIVATION_EVENT, ...types.map((t) => `onTaskType:${t}`)];
            await Promise.all(events.map((event) => extensions.activateByEvent(event)));
        }),
    );
    store.add(tasks.setCustomExecutionTerminals(ptyTerminals));
    return store;
}
