// The tasks of a debug configuration: finding and running them, `debug.onTaskErrors`, the dialogs and their
// remembered choices, cancelling, background tasks and the slow-task warning.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type MockStateService, mockStateService } from "../../../../../TestUtils/mockDebug.ts";
import { makeTask, TASK_FOLDER } from "../../../../../TestUtils/taskFixtures.ts";
import { Emitter } from "../../../../base/common/event.ts";
import type { IMarker } from "../../../../platform/markers/common/iMarker.ts";
import { MarkerSeverity } from "../../../../platform/markers/common/iMarker.ts";
import type { INotificationMessage } from "../../../services/notification/browser/notificationService.ts";
import type { ITaskEvent, ITaskSummary } from "../../tasks/browser/taskService.ts";
import { type ITask, taskMatches } from "../../tasks/common/tasks.ts";

import {
    DebugTaskRunner,
    type IDebugTaskRunnerPorts,
    SLOW_TASK_WARNING_DELAY_MS,
    TaskRunResult,
} from "./debugTaskRunner.ts";

const ERROR_MARKER = { severity: MarkerSeverity.Error } as IMarker;

describe("DebugTaskRunner", () => {
    let tasks: ITask[];
    let active: ITask[];
    let ran: string[];
    let terminated: string[];
    let runs: Map<string, PromiseWithResolvers<ITaskSummary | undefined>>;
    let events: Emitter<ITaskEvent>;
    let markers: IMarker[];
    let settings: Record<string, unknown>;
    let written: [string, unknown][];
    let shown: INotificationMessage[];
    let answers: (number | undefined)[];
    let checkbox: boolean;
    let dismissed: number[];
    let state: MockStateService;
    let calls: string[];
    let groupedTypes: (string | undefined)[];
    let runner: DebugTaskRunner;
    let autoEnd: number | undefined | "pending";
    let terminateFails: boolean;
    /** The task's terminal never reports its start. */
    let noStart: boolean;

    function end(task: ITask, exitCode: number | undefined): void {
        events.fire({ kind: "processEnded", task, terminalId: 1, exitCode });
        events.fire({ kind: "inactive", task, terminalId: 1 });
        runs.get(task._label)?.resolve({ exitCode });
    }

    beforeEach(() => {
        tasks = [makeTask({ label: "build" })];
        active = [];
        ran = [];
        terminated = [];
        terminateFails = false;
        noStart = false;
        runs = new Map();
        events = new Emitter();
        markers = [];
        settings = { "debug.onTaskErrors": "prompt", "debug.hideSlowPreLaunchWarning": false };
        written = [];
        shown = [];
        answers = [];
        checkbox = false;
        dismissed = [];
        state = mockStateService();
        calls = [];
        groupedTypes = [];
        autoEnd = 0;
        let id = 0;
        const ports: IDebugTaskRunnerPorts = {
            tasks: {
                groupedTasks: (type) => {
                    groupedTypes.push(type);
                    return Promise.resolve(tasks);
                },
                taskIdentifierOf: (arg: unknown) =>
                    typeof arg === "string"
                        ? arg
                        : (arg as { type: string }).type === "bad"
                          ? undefined
                          : { ...(arg as { type: string }), _key: (arg as { key: string }).key },
                findTask: (all, key) => all.find((task) => taskMatches(task, key)),
                run: (task) => {
                    ran.push(task._label);
                    const run = Promise.withResolvers<ITaskSummary | undefined>();
                    runs.set(task._label, run);
                    if (!noStart) events.fire({ kind: "start", task, terminalId: 1, resolvedDefinition: {} });
                    events.fire({ kind: "active", task, terminalId: 1 });
                    if (autoEnd !== "pending") end(task, autoEnd);
                    return run.promise;
                },
                terminate: (task) => {
                    terminated.push(task._label);
                    if (terminateFails) return Promise.reject(new Error("the terminal is gone"));
                    end(task, undefined);
                    return Promise.resolve(true);
                },
                getActiveTasks: () => active,
                onDidStateChange: events.event,
            },
            markers: { read: (filter) => (filter?.severities?.includes(MarkerSeverity.Error) ? markers : []) },
            configuration: {
                get: ((key: string) => settings[key]) as never,
                updateValue: (key, value) => {
                    written.push([key, value]);
                    return Promise.resolve();
                },
            },
            notifications: {
                show: (message) => {
                    shown.push(message);
                    const checked = checkbox;
                    return {
                        id: ++id,
                        answered: Promise.resolve(answers.shift()),
                        checkboxChecked: () => checked,
                    };
                },
                dismiss: (notificationId) => {
                    dismissed.push(notificationId);
                },
            },
            state,
            openProblemsView: () => {
                calls.push("problems");
            },
            configureTask: () => {
                calls.push("configureTask");
                return Promise.resolve();
            },
        };
        runner = new DebugTaskRunner(ports);
    });

    afterEach(() => {
        runner.dispose();
        vi.useRealTimers();
    });

    describe("a task that ran", () => {
        it("no task is a success without looking at the problems", async () => {
            markers = [ERROR_MARKER];

            expect(await runner.runTaskAndCheckErrors(TASK_FOLDER, undefined)).toBe(TaskRunResult.Success);
            expect(ran).toEqual([]);
        });

        it("a label runs the task of that label; exit code 0 is a success even with problems", async () => {
            markers = [ERROR_MARKER];

            expect(await runner.runTaskAndCheckErrors(TASK_FOLDER, "build")).toBe(TaskRunResult.Success);

            expect(ran).toEqual(["build"]);
            expect(groupedTypes).toEqual([undefined]);
            expect(shown).toEqual([]);
        });

        it("a definition is looked up among the tasks of its type by key", async () => {
            const npm = makeTask({
                label: "watch",
                extension: { type: "npm", extensionId: "x.npm", source: "npm" },
                definition: { script: "watch" },
            });
            tasks = [makeTask({ label: "build" }), npm];

            await runner.runTaskAndCheckErrors(TASK_FOLDER, { type: "npm", key: npm.definition._key });

            expect(groupedTypes).toEqual(["npm"]);
            expect(ran).toEqual(["npm: watch"]);
        });

        it("a closed terminal (no exit code) is a failure without a question", async () => {
            autoEnd = undefined;

            expect(await runner.runTaskAndCheckErrors(TASK_FOLDER, "build")).toBe(TaskRunResult.Failure);
            expect(shown).toEqual([]);
        });
    });

    describe("debug.onTaskErrors", () => {
        beforeEach(() => {
            autoEnd = 2;
        });

        it("debugAnyway starts the session after a failing task", async () => {
            settings["debug.onTaskErrors"] = "debugAnyway";

            expect(await runner.runTaskAndCheckErrors(TASK_FOLDER, "build")).toBe(TaskRunResult.Success);
            expect(shown).toEqual([]);
        });

        it("showErrors opens the Problems view and does not start", async () => {
            settings["debug.onTaskErrors"] = "showErrors";

            expect(await runner.runTaskAndCheckErrors(TASK_FOLDER, "build")).toBe(TaskRunResult.Failure);
            expect(calls).toEqual(["problems"]);
        });

        it("abort does not start, quietly", async () => {
            settings["debug.onTaskErrors"] = "abort";

            expect(await runner.runTaskAndCheckErrors(TASK_FOLDER, "build")).toBe(TaskRunResult.Failure);
            expect([shown, calls]).toEqual([[], []]);
        });

        it("problems without a failing exit code fail too: a task that is already running, with errors", async () => {
            settings["debug.onTaskErrors"] = "abort";
            tasks = [makeTask({ label: "watch", isBackground: true })];
            active = [...tasks];
            markers = [ERROR_MARKER];

            expect(await runner.runTaskAndCheckErrors(TASK_FOLDER, "watch")).toBe(TaskRunResult.Failure);
            expect(ran).toEqual([]);
        });
    });

    describe("the prompt", () => {
        beforeEach(() => {
            autoEnd = 2;
        });

        it("asks with upstream's text, buttons and checkbox; Debug Anyway starts", async () => {
            answers = [0];

            expect(await runner.runTaskAndCheckErrors(TASK_FOLDER, "build")).toBe(TaskRunResult.Success);

            expect(shown).toEqual([
                {
                    severity: "warn",
                    message: "The preLaunchTask 'build' terminated with exit code 2.",
                    modal: true,
                    items: ["Debug Anyway", "Show Errors", "Abort"],
                    closeAffordance: 2,
                    checkbox: { label: "Remember my choice in user settings" },
                },
            ]);
            expect(written).toEqual([]);
        });

        it("names one or several errors from the Problems; an identifier by its name", async () => {
            answers = [2, 2];
            markers = [ERROR_MARKER];
            await runner.runTaskAndCheckErrors(TASK_FOLDER, "build");
            markers = [ERROR_MARKER, ERROR_MARKER];
            tasks = [makeTask({ label: "build", extension: { type: "npm", extensionId: "x", source: "npm" } })];
            await runner.runTaskAndCheckErrors(TASK_FOLDER, {
                type: "npm",
                name: "the build",
                key: tasks[0].definition._key,
            });

            expect(shown.map((m) => m.message)).toEqual([
                "Error exists after running preLaunchTask 'build'.",
                "Errors exist after running preLaunchTask 'the build'.",
            ]);
        });

        it("Show Errors opens the Problems view; Abort and closing do not start", async () => {
            answers = [1, 2, undefined];

            expect(await runner.runTaskAndCheckErrors(TASK_FOLDER, "build")).toBe(TaskRunResult.Failure);
            expect(calls).toEqual(["problems"]);
            expect(await runner.runTaskAndCheckErrors(TASK_FOLDER, "build")).toBe(TaskRunResult.Failure);
            expect(await runner.runTaskAndCheckErrors(TASK_FOLDER, "build")).toBe(TaskRunResult.Failure);
            expect(calls).toEqual(["problems"]);
        });

        it("the checked checkbox writes the choice to debug.onTaskErrors", async () => {
            checkbox = true;
            answers = [0, 1, 2];

            await runner.runTaskAndCheckErrors(TASK_FOLDER, "build");
            await runner.runTaskAndCheckErrors(TASK_FOLDER, "build");
            await runner.runTaskAndCheckErrors(TASK_FOLDER, "build");

            expect(written).toEqual([
                ["debug.onTaskErrors", "debugAnyway"],
                ["debug.onTaskErrors", "showErrors"],
                ["debug.onTaskErrors", "abort"],
            ]);
        });
    });

    describe("a task that cannot run", () => {
        it("a label not found asks Debug Anyway / Configure Task / Cancel", async () => {
            answers = [0];

            expect(await runner.runTaskAndCheckErrors(TASK_FOLDER, "nope")).toBe(TaskRunResult.Success);

            expect(shown).toEqual([
                {
                    severity: "error",
                    message: "Could not find the task 'nope'.",
                    modal: true,
                    items: ["Debug Anyway", "Configure Task", "Cancel"],
                    closeAffordance: 2,
                    checkbox: { label: "Remember my choice for this task" },
                },
            ]);
            expect(state.values.has("debug.taskerrorchoice")).toBe(false);
        });

        it("Configure Task runs Tasks: Configure Task and does not start; closing does not start", async () => {
            answers = [1, undefined];

            expect(await runner.runTaskAndCheckErrors(TASK_FOLDER, "nope")).toBe(TaskRunResult.Failure);
            expect(calls).toEqual(["configureTask"]);
            expect(await runner.runTaskAndCheckErrors(TASK_FOLDER, "nope")).toBe(TaskRunResult.Failure);
            expect(calls).toEqual(["configureTask"]);
        });

        it("a remembered choice is taken without asking again, per message", async () => {
            checkbox = true;
            answers = [0, 2];

            await runner.runTaskAndCheckErrors(TASK_FOLDER, "nope");
            expect(state.values.get("debug.taskerrorchoice")).toEqual({ "Could not find the task 'nope'.": 0 });
            expect(await runner.runTaskAndCheckErrors(TASK_FOLDER, "nope")).toBe(TaskRunResult.Success);
            expect(shown).toHaveLength(1);

            await runner.runTaskAndCheckErrors(TASK_FOLDER, { type: "bad" });
            expect(state.values.get("debug.taskerrorchoice")).toEqual({
                "Could not find the task 'nope'.": 0,
                "Could not find the specified task.": 2,
            });
        });

        it("a definition not found, or one without a valid key, is the specified task", async () => {
            answers = [2, 2];

            await runner.runTaskAndCheckErrors(TASK_FOLDER, { type: "npm", key: "none" });
            await runner.runTaskAndCheckErrors(TASK_FOLDER, { type: "bad" });

            expect(shown.map((m) => m.message)).toEqual([
                "Could not find the specified task.",
                "Could not find the specified task.",
            ]);
            expect(groupedTypes).toEqual(["npm"]);
        });

        it("without a root the task cannot be referenced", async () => {
            answers = [2, 2];

            await runner.runTaskAndCheckErrors(undefined, "build");
            await runner.runTaskAndCheckErrors(undefined, { type: "npm" });

            expect(shown.map((m) => m.message)).toEqual([
                "Task 'build' can not be referenced from a launch configuration that is in a different workspace folder.",
                "Task 'npm' can not be referenced from a launch configuration that is in a different workspace folder.",
            ]);
            expect(ran).toEqual([]);
        });

        it("runTask itself rejects, for the post-debug task to report", async () => {
            await expect(runner.runTask(TASK_FOLDER, "nope")).rejects.toThrow("Could not find the task 'nope'.");
            expect(await runner.runTask(TASK_FOLDER, undefined)).toBeNull();
        });
    });

    describe("a running task", () => {
        it("the start waits for a non-background task to end; cancel ends the wait and the task", async () => {
            autoEnd = "pending";
            const result = runner.runTaskAndCheckErrors(TASK_FOLDER, "build");
            await vi.waitFor(() => {
                expect(ran).toEqual(["build"]);
            });

            runner.cancel();

            expect(await result).toBe(TaskRunResult.Failure);
            expect(terminated).toEqual(["build"]);
            // A new start after the cancel is not cancelled.
            autoEnd = 0;
            expect(await runner.runTaskAndCheckErrors(TASK_FOLDER, "build")).toBe(TaskRunResult.Success);
        });

        it("disposing the runner ends the wait and the task, as a cancel", async () => {
            autoEnd = "pending";
            const result = runner.runTaskAndCheckErrors(TASK_FOLDER, "build");
            await vi.waitFor(() => {
                expect(ran).toEqual(["build"]);
            });

            runner.dispose();

            expect(await result).toBe(TaskRunResult.Failure);
            expect(terminated).toEqual(["build"]);
        });

        it("a task that fails to terminate: cancel still ends the wait, quietly", async () => {
            autoEnd = "pending";
            terminateFails = true;
            const result = runner.runTaskAndCheckErrors(TASK_FOLDER, "build");
            await vi.waitFor(() => {
                expect(ran).toEqual(["build"]);
            });

            runner.cancel();

            expect(await result).toBe(TaskRunResult.Failure);
            expect([terminated, shown]).toEqual([["build"], []]);
        });

        it("a background task is waited for until its process ends, with its exit code", async () => {
            autoEnd = "pending";
            tasks = [makeTask({ label: "watch", isBackground: true })];
            const result = runner.runTask(TASK_FOLDER, "watch");
            await vi.waitFor(() => {
                expect(ran).toEqual(["watch"]);
            });
            // Another task's end is not this one's.
            events.fire({ kind: "processEnded", task: makeTask({ label: "other" }), terminalId: 2, exitCode: 9 });

            end(tasks[0], 3);

            expect(await result).toEqual({ exitCode: 3 });
        });

        it("an already running background task is ready; an already running task is waited for, not run again", async () => {
            const watch = makeTask({ label: "watch", isBackground: true });
            const build = makeTask({ label: "build" });
            tasks = [watch, build];
            active = [watch, build];

            expect(await runner.runTask(TASK_FOLDER, "watch")).toBeNull();
            const waiting = runner.runTask(TASK_FOLDER, "build");
            await new Promise((resolve) => setImmediate(resolve));
            end(build, 0);

            expect(await waiting).toEqual({ exitCode: 0 });
            expect(ran).toEqual([]);
        });

        it("another running task does not count: this one runs", async () => {
            const watch = makeTask({ label: "watch", isBackground: true });
            tasks = [watch, makeTask({ label: "build" })];
            active = [watch];

            expect(await runner.runTaskAndCheckErrors(TASK_FOLDER, "build")).toBe(TaskRunResult.Success);

            expect(ran).toEqual(["build"]);
        });

        it("an already running background task starts the session: no exit code, no problems, no question", async () => {
            const watch = makeTask({ label: "watch", isBackground: true });
            tasks = [watch];
            active = [watch];

            expect(await runner.runTaskAndCheckErrors(TASK_FOLDER, "watch")).toBe(TaskRunResult.Success);

            expect(shown).toEqual([]);
        });
    });

    describe("the slow-task warning", () => {
        beforeEach(() => {
            vi.useFakeTimers();
            autoEnd = "pending";
        });

        async function startSlow(label = "build"): Promise<{ result: Promise<TaskRunResult> }> {
            const result = runner.runTaskAndCheckErrors(TASK_FOLDER, label);
            await vi.advanceTimersByTimeAsync(0);
            return { result };
        }

        it("shows after 10 seconds with Debug Anyway / Configure Task / Abort; Debug Anyway starts", async () => {
            answers = [0];
            const { result } = await startSlow();
            await vi.advanceTimersByTimeAsync(SLOW_TASK_WARNING_DELAY_MS - 1);
            expect(shown).toEqual([]);

            await vi.advanceTimersByTimeAsync(1);

            expect(shown).toEqual([
                {
                    severity: "info",
                    message: "Waiting for preLaunchTask 'build'...",
                    modal: false,
                    items: ["Debug Anyway", "Configure Task", "Abort"],
                },
            ]);
            expect(await result).toBe(TaskRunResult.Success);
            expect(terminated).toEqual([]);
            expect(dismissed).toEqual([1]);
        });

        it("Abort ends the task; Configure Task also opens the configuration", async () => {
            answers = [2, 1];
            const { result: aborted } = await startSlow();
            await vi.advanceTimersByTimeAsync(SLOW_TASK_WARNING_DELAY_MS);
            expect(await aborted).toBe(TaskRunResult.Failure);
            expect([terminated, calls]).toEqual([["build"], []]);

            const { result: configured } = await startSlow();
            await vi.advanceTimersByTimeAsync(SLOW_TASK_WARNING_DELAY_MS);
            expect(await configured).toBe(TaskRunResult.Failure);
            expect([terminated, calls]).toEqual([["build", "build"], ["configureTask"]]);
        });

        it("Abort of a task that fails to terminate does not start, quietly", async () => {
            answers = [2];
            terminateFails = true;
            const { result } = await startSlow();
            await vi.advanceTimersByTimeAsync(SLOW_TASK_WARNING_DELAY_MS);

            expect(await result).toBe(TaskRunResult.Failure);
            expect([terminated, shown.length]).toEqual([["build"], 1]);
        });

        it("a task of an extension cannot be configured: Debug Anyway / Abort", async () => {
            tasks = [makeTask({ label: "watch", extension: { type: "npm", extensionId: "x", source: "npm" } })];
            answers = [1];
            const { result } = await startSlow("npm: watch");
            await vi.advanceTimersByTimeAsync(SLOW_TASK_WARNING_DELAY_MS);

            expect(shown[0].items).toEqual(["Debug Anyway", "Abort"]);
            expect(await result).toBe(TaskRunResult.Failure);
            expect([terminated, calls]).toEqual([["npm: watch"], []]);
        });

        it("closed without a choice it keeps waiting; the task's end takes the warning away", async () => {
            answers = [undefined];
            const { result } = await startSlow();
            await vi.advanceTimersByTimeAsync(SLOW_TASK_WARNING_DELAY_MS);

            end(tasks[0], 0);

            expect(await result).toBe(TaskRunResult.Success);
            expect(dismissed).toEqual([1]);
        });

        it("a task that ends in time shows nothing; debug.hideSlowPreLaunchWarning hides it", async () => {
            const { result: quick } = await startSlow();
            end(tasks[0], 0);
            expect(await quick).toBe(TaskRunResult.Success);

            settings["debug.hideSlowPreLaunchWarning"] = true;
            const { result: hidden } = await startSlow();
            await vi.advanceTimersByTimeAsync(SLOW_TASK_WARNING_DELAY_MS * 2);
            end(tasks[0], 0);
            expect(await hidden).toBe(TaskRunResult.Success);

            await vi.advanceTimersByTimeAsync(SLOW_TASK_WARNING_DELAY_MS * 2);
            expect(shown).toEqual([]);
        });

        it("the delay counts from the task's start: a task that never starts shows no warning", async () => {
            noStart = true;
            const { result } = await startSlow();
            await vi.advanceTimersByTimeAsync(SLOW_TASK_WARNING_DELAY_MS * 2);

            expect(shown).toEqual([]);
            end(tasks[0], 0);
            expect(await result).toBe(TaskRunResult.Success);
        });

        it("an already running task warns too", async () => {
            active = [...tasks];
            answers = [0];
            const { result } = await startSlow();
            await vi.advanceTimersByTimeAsync(SLOW_TASK_WARNING_DELAY_MS);

            expect(shown).toHaveLength(1);
            expect(await result).toBe(TaskRunResult.Success);
        });
    });
});
