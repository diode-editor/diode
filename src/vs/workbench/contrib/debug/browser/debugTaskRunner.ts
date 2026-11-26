/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/debugTaskRunner.ts
// Runs the `preLaunchTask`/`postDebugTask` of a debug configuration and decides by `debug.onTaskErrors` whether
// debugging goes on. Deviations: our task system marks every task active as it starts, so upstream's "the task has
// not exited and doesn't have a 'problemMatcher'" timeout cannot fire and is left out; a background task has no
// problem matcher yet (the task system ignores it), so the session waits for its process to end, and an already
// running background task is taken as ready (upstream asks whether it is busy); the slow-task warning is a
// notification with the same buttons, not a progress one; "Configure Task" runs Tasks: Configure Task.

import { CancellationTokenSource, type ICancellationToken } from "../../../../base/common/cancellation.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { DisposableStore, type IDisposable, toDisposable } from "../../../../base/common/lifecycle.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { MarkerSeverity } from "../../../../platform/markers/common/iMarker.ts";
import type { MarkerService } from "../../../../platform/markers/common/markerService.ts";
import type { IStateDescriptor, IStateService } from "../../../../platform/state/common/iStateService.ts";
import type { IWorkspace, IWorkspaceFolder } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import type { NotificationService } from "../../../services/notification/browser/notificationService.ts";
import type { ITaskEvent, ITaskSummary, TaskService } from "../../tasks/browser/taskService.ts";
import { getMapKey, type ITask } from "../../tasks/common/tasks.ts";
import type { ITaskIdentifier } from "../common/debug.ts";

export const enum TaskRunResult {
    Failure,
    Success,
}

const DEBUG_TASK_ERROR_CHOICE_KEY: IStateDescriptor<Partial<Record<string, number>>> = {
    key: "debug.taskerrorchoice",
    scope: "workspace",
    default: {},
};
const ABORT_LABEL = "Abort";
const DEBUG_ANYWAY_LABEL = "Debug Anyway";
const CONFIGURE_TASK_LABEL = "Configure Task";
export const SLOW_TASK_WARNING_DELAY_MS = 10_000;

/** What the runner talks to; the DI module builds it from the workbench services. */
export interface IDebugTaskRunnerPorts {
    readonly tasks: Pick<
        TaskService,
        "groupedTasks" | "taskIdentifierOf" | "findTask" | "run" | "terminate" | "getActiveTasks" | "onDidStateChange"
    >;
    readonly markers: Pick<MarkerService, "read">;
    readonly configuration: Pick<IConfigurationService, "get" | "updateValue">;
    readonly notifications: Pick<NotificationService, "show" | "dismiss">;
    readonly state: Pick<IStateService, "get" | "store">;
    readonly openProblemsView: () => void;
    /** Upstream `ITaskService.configureAction()`: Tasks: Configure Task. */
    readonly configureTask: () => Promise<void>;
}

/** The buttons of the dialogs: of a task that failed (…, Show Errors, Abort) and of one that could not run. */
const CHOICE_DEBUG_ANYWAY = 0;
const CHOICE_SHOW_ERRORS = 1;
const CHOICE_ABORT = 2;
const CHOICE_CONFIGURE_TASK = 1;
const CHOICE_CANCEL = 2;

export class DebugTaskRunner implements IDisposable {
    private globalCancellation = new CancellationTokenSource();

    public constructor(private readonly ports: IDebugTaskRunnerPorts) {}

    // A cancelled source has no listeners left to release: upstream's `dispose(true)` is the `cancel()` here.
    public cancel(): void {
        this.globalCancellation.cancel();
        this.globalCancellation = new CancellationTokenSource();
    }

    public dispose(): void {
        this.globalCancellation.cancel();
    }

    public async runTaskAndCheckErrors(
        root: IWorkspaceFolder | IWorkspace | undefined,
        taskId: string | ITaskIdentifier | undefined,
    ): Promise<TaskRunResult> {
        // Without a task there is nothing to check (upstream reads the problems only for a task).
        if (!taskId) {
            return TaskRunResult.Success;
        }
        try {
            const taskSummary = await this.runTask(root, taskId, this.globalCancellation.token);
            if (taskSummary && taskSummary.exitCode === undefined) {
                // User canceled, either debugging, or the prelaunch task (upstream also marks it `cancelled`)
                return TaskRunResult.Failure;
            }

            const errorCount = this.ports.markers.read({ severities: [MarkerSeverity.Error] }).length;
            // A task that was already running and ready has no summary: no exit code to judge by.
            const exitCode = taskSummary?.exitCode;
            const onTaskErrors = this.ports.configuration.get("debug.onTaskErrors");
            // A summary here has an exit code (an undefined one ended above): 0 succeeds, any other fails.
            if (exitCode === 0 || onTaskErrors === "debugAnyway" || (errorCount === 0 && !taskSummary)) {
                return TaskRunResult.Success;
            }
            if (onTaskErrors === "showErrors") {
                this.ports.openProblemsView();
                return TaskRunResult.Failure;
            }
            if (onTaskErrors === "abort") {
                return TaskRunResult.Failure;
            }

            // Here a task ran: without errors it failed by its exit code. Upstream also has "The preLaunchTask '{0}'
            // terminated." for a summary without a code, which ends above as a cancel.
            const taskLabel = typeof taskId === "string" ? taskId : String(taskId.name);
            const message =
                errorCount > 1
                    ? `Errors exist after running preLaunchTask '${taskLabel}'.`
                    : errorCount === 1
                      ? `Error exists after running preLaunchTask '${taskLabel}'.`
                      : `The preLaunchTask '${taskLabel}' terminated with exit code ${String(exitCode)}.`;

            // Upstream's buttons, with the cancel button last.
            const handle = this.ports.notifications.show({
                severity: "warn",
                message,
                modal: true,
                items: [DEBUG_ANYWAY_LABEL, "Show Errors", ABORT_LABEL],
                closeAffordance: CHOICE_ABORT,
                checkbox: { label: "Remember my choice in user settings" },
            });
            const result = await handle.answered;
            const debugAnyway = result === CHOICE_DEBUG_ANYWAY;
            const abort = result !== CHOICE_DEBUG_ANYWAY && result !== CHOICE_SHOW_ERRORS;
            // Stryker disable next-line OptionalChaining: equivalent, NotificationService.show gives a message with a checkbox its `checkboxChecked`
            if (handle.checkboxChecked?.() === true) {
                void this.ports.configuration.updateValue(
                    "debug.onTaskErrors",
                    debugAnyway ? "debugAnyway" : abort ? "abort" : "showErrors",
                );
            }

            if (abort) {
                return TaskRunResult.Failure;
            }
            if (debugAnyway) {
                return TaskRunResult.Success;
            }

            this.ports.openProblemsView();
            return TaskRunResult.Failure;
        } catch (err) {
            return await this.onTaskError(err as Error);
        }
    }

    /** A task that could not run: the choice may be remembered per message, in the workspace. */
    private async onTaskError(err: Error): Promise<TaskRunResult> {
        const choiceMap = this.ports.state.get(DEBUG_TASK_ERROR_CHOICE_KEY);

        let choice = choiceMap[err.message];
        if (choice === undefined) {
            const handle = this.ports.notifications.show({
                severity: "error",
                message: err.message,
                modal: true,
                items: [DEBUG_ANYWAY_LABEL, CONFIGURE_TASK_LABEL, "Cancel"],
                closeAffordance: CHOICE_CANCEL,
                checkbox: { label: "Remember my choice for this task" },
            });
            choice = (await handle.answered) ?? CHOICE_CANCEL;
            // Stryker disable next-line OptionalChaining: equivalent, NotificationService.show gives a message with a checkbox its `checkboxChecked`
            if (handle.checkboxChecked?.() === true) {
                this.ports.state.store(DEBUG_TASK_ERROR_CHOICE_KEY, { ...choiceMap, [err.message]: choice });
            }
        }

        if (choice === CHOICE_CONFIGURE_TASK) {
            await this.ports.configureTask();
        }

        return choice === CHOICE_DEBUG_ANYWAY ? TaskRunResult.Success : TaskRunResult.Failure;
    }

    public async runTask(
        root: IWorkspace | IWorkspaceFolder | undefined,
        taskId: string | ITaskIdentifier | undefined,
        token: ICancellationToken = this.globalCancellation.token,
    ): Promise<ITaskSummary | null | undefined> {
        if (!taskId) {
            return null;
        }
        if (!root) {
            throw new Error(
                `Task '${typeof taskId === "string" ? taskId : taskId.type}' can not be referenced from a launch configuration that is in a different workspace folder.`,
            );
        }
        // run a task before starting a debug session
        const task = await this.getTask(taskId);
        if (!task) {
            const errorMessage =
                typeof taskId === "string"
                    ? `Could not find the task '${taskId}'.`
                    : "Could not find the specified task.";
            throw new Error(errorMessage);
        }

        const tasks = this.ports.tasks;
        const store = new DisposableStore();
        const taskKey = getMapKey(task);
        const ofTask = (e: ITaskEvent): boolean => "task" in e && getMapKey(e.task) === taskKey;
        const inactivePromise = new Promise<ITaskSummary | null>((resolve) => {
            // The listener goes with the store when the run is over.
            store.add(
                tasks.onDidStateChange((e) => {
                    // The process end comes before `inactive` and carries the exit code.
                    if (e.kind === "processEnded" && ofTask(e)) {
                        resolve({ exitCode: e.exitCode });
                    }
                }),
            );
        });

        const didAcquireInput = store.add(new Emitter<void>());
        store.add(
            tasks.onDidStateChange((e) => {
                if (e.kind === "start" && ofTask(e)) {
                    didAcquireInput.fire();
                }
            }),
        );

        // As upstream, the task starts a tick later: the listeners of the warning below are in place by then.
        // A run with a cancelled input has no summary (upstream: `null`).
        const taskDonePromise = Promise.resolve().then((): Promise<ITaskSummary | null | undefined> => {
            if (tasks.getActiveTasks().some((t) => getMapKey(t) === taskKey)) {
                didAcquireInput.fire();
                // A running background task is ready; a running task of another kind is waited for.
                return task.isBackground ? Promise.resolve(null) : inactivePromise;
            }

            const taskPromise = tasks.run(task);
            return task.isBackground ? inactivePromise : taskPromise;
        });

        const result = new Promise<ITaskSummary | null | undefined>((resolve, reject) => {
            taskDonePromise.then(resolve, reject);

            store.add(
                token.onCancellationRequested(() => {
                    // Stryker disable next-line ObjectLiteral: equivalent, `{}` has no exit code either
                    resolve({ exitCode: undefined });
                    tasks.terminate(task).catch(() => undefined);
                }),
            );

            // Start the timeout once a terminal has been acquired
            store.add(
                didAcquireInput.event(() => {
                    if (this.ports.configuration.get("debug.hideSlowPreLaunchWarning")) {
                        return;
                    }
                    // Notification shown on any task taking a while to resolve
                    const timer = setTimeout(() => {
                        this.showSlowTaskWarning(task, store, resolve);
                    }, SLOW_TASK_WARNING_DELAY_MS);
                    store.add(
                        toDisposable(() => {
                            clearTimeout(timer);
                        }),
                    );
                }),
            );
        });

        try {
            return await result;
        } finally {
            store.dispose();
        }
    }

    private showSlowTaskWarning(task: ITask, store: DisposableStore, resolve: (summary: ITaskSummary) => void): void {
        const canConfigure = task.source.kind === "workspace";
        const items = canConfigure
            ? [DEBUG_ANYWAY_LABEL, CONFIGURE_TASK_LABEL, ABORT_LABEL]
            : [DEBUG_ANYWAY_LABEL, ABORT_LABEL];
        const handle = this.ports.notifications.show({
            severity: "info",
            message: `Waiting for preLaunchTask '${task.name}'...`,
            modal: false,
            items,
        });
        // The task finished first: the warning goes away with it.
        store.add(
            toDisposable(() => {
                this.ports.notifications.dismiss(handle.id);
            }),
        );
        void handle.answered.then((choice) => {
            if (choice === undefined) {
                // no-op, keep waiting
            } else if (choice === 0) {
                // debug anyway
                resolve({ exitCode: 0 });
            } else {
                // abort or configure
                // Stryker disable next-line ObjectLiteral: equivalent, `{}` has no exit code either
                resolve({ exitCode: undefined });
                this.ports.tasks.terminate(task).catch(() => undefined);
                if (canConfigure && choice === 1) {
                    void this.ports.configureTask();
                }
            }
        });
    }

    /** Upstream `ITaskService.getTask`: a label, or a definition matched by its key among the tasks of its type. */
    private async getTask(taskId: string | ITaskIdentifier): Promise<ITask | undefined> {
        const key = this.ports.tasks.taskIdentifierOf(taskId);
        if (key === undefined) {
            return undefined;
        }
        // Stryker disable next-line ConditionalExpression,StringLiteral: equivalent, a string has no `type` either
        const tasks = await this.ports.tasks.groupedTasks(typeof taskId === "string" ? undefined : taskId.type);
        return this.ports.tasks.findTask(tasks, key);
    }
}
