import { afterEach, describe, expect, it, vi } from "vitest";

import { makeTask } from "../../../../../TestUtils/taskFixtures.ts";
import { buildTaskServiceHarness, tasksJsonOf } from "../../../../../TestUtils/taskServiceHarness.ts";
import type { ITaskDefinitionSchema } from "../../../api/common/taskIdentity.ts";
import { DEFAULT_PRESENTATION } from "../common/tasks.ts";

import { type ITaskProvider, TASK_PROVIDER_TIMEOUT_MS } from "./taskService.ts";

const definition = (taskType: string, when?: string): ITaskDefinitionSchema => ({
    extensionId: "pub.ext",
    taskType,
    required: [],
    properties: {},
    when,
});

const provider = (tasks: Parameters<typeof makeTask>[0][]): ITaskProvider => ({
    provideTasks: () => Promise.resolve(tasks.map(makeTask)),
});

const ext = (type: string) => ({ type, extensionId: "pub.ext", source: "Ext" });

afterEach(() => {
    vi.useRealTimers();
});

describe("TaskService — tasks.json tasks", () => {
    it("reads .diode/tasks.json of the first folder", async () => {
        const h = buildTaskServiceHarness({ tasksJson: tasksJsonOf([{ label: "a", command: "x" }]) });
        const tasks = await h.service.getWorkspaceTasks();
        expect(tasks.map((t) => t._label)).toStrictEqual(["a"]);
        expect(h.readFile.mock.calls[0][0].fsPath).toBe("/ws/.diode/tasks.json");
        h.dispose();
    });

    it("no file or folder — empty, no messages", async () => {
        const noFile = buildTaskServiceHarness();
        await expect(noFile.service.getWorkspaceTasks()).resolves.toStrictEqual([]);
        noFile.dispose();
        const noFolder = buildTaskServiceHarness({
            folder: null,
            tasksJson: tasksJsonOf([{ label: "a", command: "x" }]),
        });
        await expect(noFolder.service.getWorkspaceTasks()).resolves.toStrictEqual([]);
        expect(noFolder.readFile).not.toHaveBeenCalled();
        noFolder.dispose();
    });

    it("parse problems go to the `tasks` log once per file text", async () => {
        const h = buildTaskServiceHarness({ tasksJson: tasksJsonOf([{ command: "x" }]) });
        await h.service.getWorkspaceTasks();
        await h.service.getWorkspaceTasks();
        expect(h.logger.warn).toHaveBeenCalledTimes(1);
        expect(h.logger.warn.mock.calls[0][0]).toMatch(/^Error: a task must provide a label property/u);
        h.setTasksJson(tasksJsonOf([{ command: "y" }]));
        await h.service.getWorkspaceTasks();
        expect(h.logger.warn).toHaveBeenCalledTimes(2);
        h.dispose();
    });

    it("error in tasks.json — upstream toast once per text; 'Show Output' — the Output panel on the Tasks channel", async () => {
        const h = buildTaskServiceHarness({ tasksJson: '{ "version": "2.0.0", "tasks": [ { "label": "x", ' });
        const openView = vi.spyOn(h.views.service, "openView");
        await h.service.getWorkspaceTasks();
        await h.service.getWorkspaceTasks();
        const ask = h.notifications.current();
        expect([ask?.modal, ask?.severity, ask?.message, ask?.items]).toStrictEqual([
            false,
            "warn",
            "There are task errors. See the output for details.",
            ["Show Output"],
        ]);
        // A second read of the same text does not repeat the toast.
        expect(h.notifications.queuedCount()).toBe(0);
        expect(h.logger.warn.mock.calls[0][0]).toBe(
            "Error: The content of the tasks.json file has syntax errors. Please correct them before executing a task.",
        );
        h.notifications.answer(ask!.id, 0);
        await vi.waitFor(() => {
            expect(h.output.showChannel).toHaveBeenCalledWith("tasks");
        });
        expect(openView).toHaveBeenCalledWith("workbench.panel.output", false, false);
        h.dispose();
    });

    it("warnings only — no toast; a toast closed without a choice does not open Output", async () => {
        const warned = buildTaskServiceHarness({
            tasksJson: tasksJsonOf([{ label: "a", command: "x", dependsOn: ["b"] }]),
        });
        await warned.service.getWorkspaceTasks();
        expect(warned.notifications.current()).toBeNull();
        warned.dispose();
        const h = buildTaskServiceHarness({ tasksJson: tasksJsonOf([{ command: "x" }]) });
        await h.service.getWorkspaceTasks();
        h.notifications.answer(h.notifications.current()!.id, -1);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(h.output.showChannel).not.toHaveBeenCalled();
        h.dispose();
    });
});

describe("TaskService — providers and types", () => {
    it("tasks(): tasks.json, then provider tasks; with a type — only tasks of that type's provider", async () => {
        const h = buildTaskServiceHarness({ tasksJson: tasksJsonOf([{ label: "w", type: "shell", command: "x" }]) });
        h.service.registerTaskProvider(provider([{ label: "a", extension: ext("npm") }]), "npm");
        h.service.registerTaskProvider(provider([{ label: "b", extension: ext("gulp") }]), "gulp");
        expect((await h.service.tasks()).map((t) => t._label)).toStrictEqual(["w", "Ext: a", "Ext: b"]);
        expect((await h.service.tasks({ type: "npm" })).map((t) => t._label)).toStrictEqual(["Ext: a"]);
        expect((await h.service.tasks({ type: "shell" })).map((t) => t._label)).toStrictEqual([]);
        expect((await h.service.groupedTasks("npm")).map((t) => t._label)).toStrictEqual(["w", "Ext: a"]);
        h.dispose();
    });

    it("the activator is called with the type (undefined without one) before providers are queried", async () => {
        const h = buildTaskServiceHarness();
        const activator = vi.fn(() => Promise.resolve());
        h.service.setProviderActivator(activator);
        await h.service.tasks({ type: "npm" });
        await h.service.tasks();
        expect(activator.mock.calls).toStrictEqual([["npm"], [undefined]]);
        h.dispose();
    });

    it("an unregistered activator and provider are no longer called; another registration's dispose does not touch the active one", async () => {
        const h = buildTaskServiceHarness();
        const first = vi.fn(() => Promise.resolve());
        const second = vi.fn(() => Promise.resolve());
        const firstRegistration = h.service.setProviderActivator(first);
        h.service.setProviderActivator(second);
        firstRegistration.dispose();
        await h.service.tasks();
        expect(second).toHaveBeenCalledTimes(1);
        const registration = h.service.setProviderActivator(second);
        registration.dispose();
        await h.service.tasks();
        expect(second).toHaveBeenCalledTimes(1);

        const p = vi.fn(() => Promise.resolve([]));
        h.service.registerTaskProvider({ provideTasks: p }, "npm").dispose();
        await h.service.tasks();
        expect(p).not.toHaveBeenCalled();
        h.dispose();
    });

    it("task.autoDetect: off — providers are not queried, no types", async () => {
        const h = buildTaskServiceHarness({ settings: { "task.autoDetect": "off" } });
        const p = vi.fn(() => Promise.resolve([]));
        h.service.registerTaskProvider({ provideTasks: p }, "npm");
        h.service.registerTaskDefinitions([definition("npm")]);
        await h.service.tasks();
        expect(await h.service.tasks({ type: "npm" })).toStrictEqual([]);
        expect(p).not.toHaveBeenCalled();
        expect(h.service.taskTypes()).toStrictEqual([]);
        h.dispose();
    });

    it("types with an unmet when are hidden and their provider is not queried", async () => {
        const h = buildTaskServiceHarness();
        h.service.registerTaskDefinitions([definition("npm"), definition("hidden", "taskRunning")]);
        const p = vi.fn(() => Promise.resolve([]));
        h.service.registerTaskProvider({ provideTasks: p }, "hidden");
        expect(h.service.taskTypes()).toStrictEqual(["npm"]);
        await h.service.tasks();
        expect(p).not.toHaveBeenCalled();
        h.contextKeys.set("taskRunning", true);
        expect(h.service.taskTypes()).toStrictEqual(["npm", "hidden"]);
        expect(h.service.getTaskDefinition("npm")?.taskType).toBe("npm");
        expect(h.service.getTaskDefinition("none")).toBeUndefined();
        h.dispose();
    });

    it("a repeated type in definitions — the last one wins; onDidChangeDefinitions", () => {
        const h = buildTaskServiceHarness();
        const changed = vi.fn();
        h.service.onDidChangeDefinitions(changed);
        h.service.registerTaskDefinitions([definition("npm")]);
        h.service.registerTaskDefinitions([{ ...definition("npm"), extensionId: "other" }]);
        expect(h.service.getTaskDefinition("npm")?.extensionId).toBe("other");
        expect(changed).toHaveBeenCalledTimes(2);
        h.dispose();
    });

    it("provider failure — a log message and empty; a task of another type — upstream warning", async () => {
        const h = buildTaskServiceHarness();
        h.service.registerTaskProvider({ provideTasks: () => Promise.reject(new Error("boom")) }, "a");
        h.service.registerTaskProvider({ provideTasks: () => Promise.reject("raw" as unknown as Error) }, "b");
        h.service.registerTaskProvider(
            provider([
                { label: "x", extension: ext("other") },
                { label: "y", extension: ext("other") },
            ]),
            "c",
        );
        const tasks = await h.service.tasks();
        expect(tasks.map((t) => t.name)).toStrictEqual(["x", "y"]);
        expect(h.logger.warn.mock.calls.map((c: unknown[]) => c[0])).toStrictEqual([
            "Error: boom",
            "Error: raw",
            'The task provider for "c" tasks unexpectedly provided a task of type "other".',
        ]);
        expect(await h.service.tasks({ type: "c" })).toStrictEqual([]);
        h.dispose();
    });

    it("a slow provider and activation are awaited for no longer than 5 s", async () => {
        vi.useFakeTimers();
        const h = buildTaskServiceHarness();
        h.service.setProviderActivator(() => new Promise(() => undefined));
        h.service.registerTaskProvider({ provideTasks: () => new Promise(() => undefined) }, "slow");
        h.service.registerTaskProvider(provider([{ label: "fast", extension: ext("fast") }]), "fast");
        const pending = h.service.tasks();
        await vi.advanceTimersByTimeAsync(TASK_PROVIDER_TIMEOUT_MS);
        await vi.advanceTimersByTimeAsync(TASK_PROVIDER_TIMEOUT_MS);
        expect((await pending).map((t) => t.name)).toStrictEqual(["fast"]);
        expect(h.logger.warn.mock.calls.map((c: unknown[]) => c[0])).toStrictEqual([
            "Timed out activating extensions for task providers",
            'Timed out waiting for the task provider for "slow" tasks.',
        ]);
        h.dispose();
    });

    it("getTaskById searches all tasks", async () => {
        const h = buildTaskServiceHarness({ tasksJson: tasksJsonOf([{ label: "w", command: "x" }]) });
        h.service.registerTaskProvider(provider([{ label: "a", extension: ext("npm") }]), "npm");
        expect((await h.service.getTaskById("$core.w"))?.name).toBe("w");
        expect((await h.service.getTaskById("pub.ext.type,npm,"))?.name).toBe("a");
        expect(await h.service.getTaskById("nope")).toBeUndefined();
        h.dispose();
    });
});

describe("TaskService — running", () => {
    it("task.saveBeforeRun: always — save all and run", async () => {
        const h = buildTaskServiceHarness();
        const done = h.service.run(makeTask());
        await vi.waitFor(() => {
            expect(h.sessions).toHaveLength(1);
        });
        expect(h.saveAll).toHaveBeenCalledTimes(1);
        expect(h.confirm).not.toHaveBeenCalled();
        h.sessions[0].emitExit(0);
        await expect(done).resolves.toStrictEqual({ exitCode: 0 });
        h.dispose();
    });

    it("always with dirty editors — save without asking", async () => {
        const h = buildTaskServiceHarness({ settings: { "task.saveBeforeRun": "always" } });
        h.setDirty([{}]);
        void h.service.run(makeTask());
        await vi.waitFor(() => {
            expect(h.sessions).toHaveLength(1);
        });
        expect(h.confirm).not.toHaveBeenCalled();
        expect(h.saveAll).toHaveBeenCalledTimes(1);
        h.dispose();
    });

    it("never — do not save; prompt without dirty editors — save without asking", async () => {
        const never = buildTaskServiceHarness({ settings: { "task.saveBeforeRun": "never" } });
        void never.service.run(makeTask());
        await vi.waitFor(() => {
            expect(never.sessions).toHaveLength(1);
        });
        expect(never.saveAll).not.toHaveBeenCalled();
        never.dispose();
        const prompt = buildTaskServiceHarness({ settings: { "task.saveBeforeRun": "prompt" } });
        void prompt.service.run(makeTask());
        await vi.waitFor(() => {
            expect(prompt.sessions).toHaveLength(1);
        });
        expect(prompt.confirm).not.toHaveBeenCalled();
        expect(prompt.saveAll).toHaveBeenCalledTimes(1);
        prompt.dispose();
    });

    it("prompt with dirty editors — upstream dialog; Save — save, Don't Save — run without saving", async () => {
        const h = buildTaskServiceHarness({ settings: { "task.saveBeforeRun": "prompt" } });
        h.setDirty([{}]);
        void h.service.run(makeTask({ label: "a" }));
        await vi.waitFor(() => {
            expect(h.sessions).toHaveLength(1);
        });
        expect(h.confirm).toHaveBeenCalledWith({
            title: "Save all editors?",
            message: "Do you want to save all editors before running the task?",
            confirmLabel: "Save",
            cancelLabel: "Don't Save",
            defaultButton: "confirm",
        });
        expect(h.saveAll).toHaveBeenCalledTimes(1);
        h.confirm.mockResolvedValueOnce(false);
        void h.service.run(makeTask({ label: "b" }));
        await vi.waitFor(() => {
            expect(h.sessions).toHaveLength(2);
        });
        expect(h.saveAll).toHaveBeenCalledTimes(1);
        h.dispose();
    });

    it("run refusal — a toast with the error text, a log line, the promise is rejected", async () => {
        const h = buildTaskServiceHarness();
        await expect(h.service.run(makeTask({ command: { name: "${input:x}" } }))).rejects.toThrow(
            "Variable ${input:x} is not supported in tasks yet.",
        );
        expect(h.notifications.passive().map((n) => [n.severity, n.message])).toStrictEqual([
            ["error", "Variable ${input:x} is not supported in tasks yet."],
        ]);
        expect(h.logger.error).toHaveBeenCalledWith("Variable ${input:x} is not supported in tasks yet.");
        h.dispose();
    });

    it("variables come from the folder and the active file editor (1-based cursor line)", async () => {
        const h = buildTaskServiceHarness();
        h.setActiveEditor("/ws/src/a.ts", 4);
        void h.service.run(makeTask({ command: { name: "echo ${relativeFile}:${lineNumber} ${cwd}" } }));
        await vi.waitFor(() => {
            expect(h.terminals.getInstances()).toHaveLength(1);
        });
        expect(h.terminals.getInstances()[0].launch.shellArgs).toStrictEqual(["-c", "echo src/a.ts:5 /ws"]);
        h.setActiveEditor("untitled:Untitled-1");
        await expect(h.service.run(makeTask({ label: "b", command: { name: "echo ${file}" } }))).rejects.toThrow(
            "Please open an editor.",
        );
        h.dispose();
    });

    it("without a workspace folder the task runs; ${userHome} is the home directory", async () => {
        const h = buildTaskServiceHarness({ folder: null });
        vi.stubEnv("HOME", "/home/someone");
        vi.stubEnv("USERPROFILE", undefined);
        void h.service.run(makeTask({ folder: null, command: { name: "echo ${userHome}" } }));
        await vi.waitFor(() => {
            expect(h.terminals.getInstances()).toHaveLength(1);
        });
        vi.unstubAllEnvs();
        expect(h.terminals.getInstances()[0].launch.shellArgs).toStrictEqual(["-c", "echo /home/someone"]);
        h.dispose();
    });

    it("without HOME, ${userHome} is USERPROFILE", async () => {
        const h = buildTaskServiceHarness();
        vi.stubEnv("HOME", undefined);
        vi.stubEnv("USERPROFILE", "/Users/someone");
        void h.service.run(makeTask({ command: { name: "echo ${userHome}" } }));
        await vi.waitFor(() => {
            expect(h.terminals.getInstances()).toHaveLength(1);
        });
        vi.unstubAllEnvs();
        expect(h.terminals.getInstances()[0].launch.shellArgs).toStrictEqual(["-c", "echo /Users/someone"]);
        h.dispose();
    });

    it("config and env are available to variables", async () => {
        const h = buildTaskServiceHarness({ settings: { "task.autoDetect": "on" } });
        vi.stubEnv("DIODE_TASK_VAR", "env-value");
        void h.service.run(makeTask({ command: { name: "echo ${config:task.autoDetect} ${env:DIODE_TASK_VAR}" } }));
        await vi.waitFor(() => {
            expect(h.terminals.getInstances()).toHaveLength(1);
        });
        vi.unstubAllEnvs();
        expect(h.terminals.getInstances()[0].launch.shellArgs).toStrictEqual(["-c", "echo on env-value"]);
        h.dispose();
    });

    it("task.verboseLogging — task events go to the log; without it — silence", async () => {
        const verbose = buildTaskServiceHarness({ settings: { "task.verboseLogging": true } });
        void verbose.service.run(makeTask());
        await vi.waitFor(() => {
            expect(verbose.logger.info).toHaveBeenCalledWith("Task Event kind: start");
        });
        verbose.dispose();
        const quiet = buildTaskServiceHarness();
        void quiet.service.run(makeTask());
        await vi.waitFor(() => {
            expect(quiet.sessions).toHaveLength(1);
        });
        expect(quiet.logger.info).not.toHaveBeenCalled();
        quiet.dispose();
    });

    it("taskRunning — while at least one task runs; set on start and end, without polling", async () => {
        const h = buildTaskServiceHarness();
        expect(h.contextKeys.evaluate("taskRunning")).toBe(false);
        void h.service.run(makeTask());
        await vi.waitFor(() => {
            expect(h.service.getActiveTasks()).toHaveLength(1);
        });
        expect(h.contextKeys.evaluate("taskRunning")).toBe(true);
        h.sessions[0].emitExit(0);
        expect(h.contextKeys.evaluate("taskRunning")).toBe(false);
        void h.service.run(makeTask({ label: "b" }));
        await vi.waitFor(() => {
            expect(h.service.getActiveTasks()).toHaveLength(1);
        });
        await h.service.terminateAll();
        expect(h.contextKeys.evaluate("taskRunning")).toBe(false);
        h.dispose();
    });
});

describe("TaskService — running an already running task (instancePolicy)", () => {
    async function runTwice(
        policy: "prompt" | "warn" | "silent" | "terminateNewest" | "terminateOldest",
        answers: (string | undefined)[] = [],
    ) {
        const h = buildTaskServiceHarness();
        h.answerPicks(...answers);
        const task = makeTask({ runOptions: { instancePolicy: policy }, presentation: { reveal: "never" } });
        void h.service.run(task);
        await vi.waitFor(() => {
            expect(h.service.getActiveTasks()).toHaveLength(1);
        });
        void h.service.run(task);
        // The rerun reached the policy (save, call into the task system).
        await vi.waitFor(() => {
            expect(h.saveAll).toHaveBeenCalledTimes(2);
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        return h;
    }

    it("prompt: 'Select an instance to terminate' picker; picking stops and runs it again", async () => {
        const h = buildTaskServiceHarness();
        h.answerPicks("build");
        const task = makeTask({ presentation: { reveal: "never" } });
        void h.service.run(task);
        await vi.waitFor(() => {
            expect(h.service.getActiveTasks()).toHaveLength(1);
        });
        const shown = vi.fn();
        h.views.panelService.onDidChangeVisibility(shown);
        void h.service.run(task);
        await vi.waitFor(() => {
            expect(h.sessions).toHaveLength(2);
        });
        expect(shown.mock.calls[0]).toStrictEqual([true]);
        expect(h.picks[0].placeholder).toBe("Select an instance to terminate");
        expect(h.lastPickLabels()).toStrictEqual(["build"]);
        expect(h.terminals.getInstances().map((i) => i.id)).toStrictEqual([2]);
        expect(h.service.getActiveTasks()).toHaveLength(1);
        h.dispose();
    });

    it("prompt: the picker shows only instances of this task, not other running ones", async () => {
        const h = buildTaskServiceHarness();
        h.answerPicks(undefined);
        void h.service.run(makeTask({ label: "other" }));
        const task = makeTask();
        void h.service.run(task);
        await vi.waitFor(() => {
            expect(h.service.getActiveTasks()).toHaveLength(2);
        });
        void h.service.run(task);
        await vi.waitFor(() => {
            expect(h.picks).toHaveLength(1);
        });
        expect(h.lastPickLabels()).toStrictEqual(["build"]);
        h.dispose();
    });

    it("prompt: cancelling the picker — the task keeps running", async () => {
        const h = await runTwice("prompt", [undefined]);
        await vi.waitFor(() => {
            expect(h.picks).toHaveLength(1);
        });
        expect(h.sessions).toHaveLength(1);
        expect(h.service.getActiveTasks()).toHaveLength(1);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(h.notifications.passive()).toStrictEqual([]);
        h.dispose();
    });

    it("prompt: failure to restart the picked instance — a toast with the error text", async () => {
        const h = buildTaskServiceHarness();
        vi.spyOn(h.service, "restart").mockRejectedValue(new Error("restart failed"));
        h.answerPicks("build");
        const task = makeTask({ runOptions: { instancePolicy: "prompt" } });
        void h.service.run(task);
        await vi.waitFor(() => {
            expect(h.service.getActiveTasks()).toHaveLength(1);
        });
        void h.service.run(task);
        await vi.waitFor(() => {
            expect(h.notifications.passive().map((n) => n.message)).toStrictEqual(["restart failed"]);
        });
        h.dispose();
    });

    it("warn: upstream warning, the task keeps running", async () => {
        const h = await runTwice("warn");
        expect(h.notifications.passive().map((n) => [n.severity, n.message])).toStrictEqual([
            ["warn", "The instance limit for this task has been reached."],
        ]);
        expect(h.sessions).toHaveLength(1);
        h.dispose();
    });

    it("silent: nothing; terminateNewest/Oldest — restart without asking", async () => {
        const silent = await runTwice("silent");
        expect(silent.picks).toStrictEqual([]);
        expect(silent.sessions).toHaveLength(1);
        silent.dispose();
        for (const policy of ["terminateNewest", "terminateOldest"] as const) {
            const h = await runTwice(policy);
            await vi.waitFor(() => {
                expect(h.sessions).toHaveLength(2);
            });
            expect(h.picks).toStrictEqual([]);
            h.dispose();
        }
    });

    it("an invisible running task is revealed when run again", async () => {
        const h = buildTaskServiceHarness();
        const task = makeTask({ runOptions: { instancePolicy: "silent" } });
        void h.service.run(task);
        await vi.waitFor(() => {
            expect(h.service.getActiveTasks()).toHaveLength(1);
        });
        h.terminals.newTerminal();
        void h.service.run(task);
        // The task's terminal is active again, so it was revealed.
        await vi.waitFor(() => {
            expect(h.terminals.getActiveInstance()?.id).toBe(1);
        });
        h.dispose();
    });
});

describe("TaskService — rerun and restart", () => {
    it("rerun: nothing to rerun and nothing running — open Run Task; editors are always saved", async () => {
        const h = buildTaskServiceHarness({ settings: { "task.saveBeforeRun": "never" } });
        const openRunTask = vi.fn(() => Promise.resolve());
        await h.service.rerun(openRunTask);
        expect(openRunTask).toHaveBeenCalledTimes(1);
        expect(h.saveAll).toHaveBeenCalledTimes(1);
        h.dispose();
    });

    it("rerun: reruns the last one; a running task without a rerun — Run Task does not open", async () => {
        const h = buildTaskServiceHarness();
        const openRunTask = vi.fn(() => Promise.resolve());
        void h.service.run(makeTask());
        await vi.waitFor(() => {
            expect(h.sessions).toHaveLength(1);
        });
        h.sessions[0].emitExit(0);
        await h.service.rerun(openRunTask);
        expect(h.sessions[0].relaunches).toHaveLength(1);
        expect(openRunTask).not.toHaveBeenCalled();
        h.dispose();

        const busy = buildTaskServiceHarness();
        void busy.service.run(makeTask({ label: "x", runOptions: { reevaluateOnRerun: false } }));
        await vi.waitFor(() => {
            expect(busy.sessions).toHaveLength(1);
        });
        await busy.service.rerun(openRunTask);
        expect(openRunTask).not.toHaveBeenCalled();
        busy.dispose();
    });

    it("rerun: rerun refusal — a toast, Run Task does not open", async () => {
        const h = buildTaskServiceHarness();
        const openRunTask = vi.fn(() => Promise.resolve());
        await h.service.run(makeTask({ command: { name: "${file}" } })).catch(() => undefined);
        // There is no last task: the run was refused before start.
        await h.service.rerun(openRunTask);
        expect(openRunTask).toHaveBeenCalledTimes(1);
        h.setActiveEditor("/ws/a.ts");
        void h.service.run(makeTask({ command: { name: "echo ${file}" } }));
        await vi.waitFor(() => {
            expect(h.sessions).toHaveLength(1);
        });
        h.sessions[0].emitExit(0);
        h.setActiveEditor(null);
        await h.service.rerun(openRunTask);
        expect(openRunTask).toHaveBeenCalledTimes(1);
        expect(h.notifications.passive().at(-1)?.message).toBe(
            "Variable ${file} can not be resolved. Please open an editor.",
        );
        h.dispose();
    });

    it("rerun of a running task without reevaluation: its instancePolicy (warn — upstream warning)", async () => {
        const h = buildTaskServiceHarness();
        const openRunTask = vi.fn(() => Promise.resolve());
        void h.service.run(makeTask({ runOptions: { reevaluateOnRerun: false, instancePolicy: "warn" } }));
        await vi.waitFor(() => {
            expect(h.sessions).toHaveLength(1);
        });
        await h.service.rerun(openRunTask);
        expect(h.notifications.passive().map((n) => n.message)).toStrictEqual([
            "The instance limit for this task has been reached.",
        ]);
        h.dispose();
    });

    it("rerun: task system exception — a toast with the text, Run Task does not open", async () => {
        const h = buildTaskServiceHarness();
        const openRunTask = vi.fn(() => Promise.resolve());
        void h.service.run(makeTask({ runOptions: { reevaluateOnRerun: false } }));
        await vi.waitFor(() => {
            expect(h.sessions).toHaveLength(1);
        });
        h.sessions[0].emitExit(0);
        vi.spyOn(h.terminals, "relaunchInstance").mockImplementation(() => {
            throw new Error("relaunch failed");
        });
        await h.service.rerun(openRunTask);
        expect(h.notifications.passive().at(-1)?.message).toBe("relaunch failed");
        expect(openRunTask).not.toHaveBeenCalled();
        h.dispose();
    });

    it("restart: stop and run the running task; a tasks.json task — as the file is now", async () => {
        const h = buildTaskServiceHarness({ tasksJson: tasksJsonOf([{ label: "a", type: "shell", command: "old" }]) });
        const [task] = await h.service.getWorkspaceTasks();
        void h.service.run(task);
        await vi.waitFor(() => {
            expect(h.sessions).toHaveLength(1);
        });
        h.setTasksJson(tasksJsonOf([{ label: "a", type: "shell", command: "new" }]));
        await h.service.restart(task);
        await vi.waitFor(() => {
            expect(h.sessions).toHaveLength(2);
        });
        expect(h.terminals.getInstances()[0].launch.shellArgs).toStrictEqual(["-c", "new"]);
        h.dispose();
    });

    it("restart: a provider task and one gone from tasks.json — the same", async () => {
        const h = buildTaskServiceHarness({ tasksJson: tasksJsonOf([]) });
        await h.service.restart(makeTask({ label: "gone", command: { name: "echo gone" } }));
        await h.service.restart(makeTask({ label: "p", extension: ext("npm"), command: { name: "echo p" } }));
        await vi.waitFor(() => {
            expect(h.sessions).toHaveLength(2);
        });
        expect(h.terminals.getInstances().map((i) => i.launch.shellArgs)).toStrictEqual([
            ["-c", "echo gone"],
            ["-c", "echo p"],
        ]);
        h.dispose();
    });

    it("restart: a task whose variables no longer resolve is reported, the restart does not reject", async () => {
        const h = buildTaskServiceHarness({ tasksJson: tasksJsonOf([{ label: "a", type: "shell", command: "old" }]) });
        const [task] = await h.service.getWorkspaceTasks();
        void h.service.run(task);
        await vi.waitFor(() => {
            expect(h.sessions).toHaveLength(1);
        });
        h.setTasksJson(tasksJsonOf([{ label: "a", type: "shell", command: "${input:x}" }]));
        await h.service.restart(task);
        await vi.waitFor(() => {
            expect(h.notifications.passive()).toHaveLength(1);
        });
        expect(h.notifications.passive()[0]).toMatchObject({
            severity: "error",
            message: expect.stringContaining("${input:x}") as string,
        });
        expect(h.sessions).toHaveLength(1);
        h.dispose();
    });

    it("terminate/terminateAll/revealTask go to the task system", async () => {
        const h = buildTaskServiceHarness();
        const task = makeTask({ presentation: { reveal: "never" } });
        expect(h.service.revealTask(task)).toBe(false);
        void h.service.run(task);
        await vi.waitFor(() => {
            expect(h.sessions).toHaveLength(1);
        });
        expect(h.service.revealTask(task)).toBe(true);
        await expect(h.service.terminate(task)).resolves.toBe(true);
        void h.service.run(makeTask({ label: "b" }));
        await vi.waitFor(() => {
            expect(h.service.getActiveTasks()).toHaveLength(1);
        });
        await h.service.terminateAll();
        expect(h.service.getActiveTasks()).toStrictEqual([]);
        h.dispose();
    });
});

describe("TaskService — command arguments and pickers", () => {
    it("taskIdentifierOf: a string as is; a definition — the key by the type schema; anything else — undefined", () => {
        const h = buildTaskServiceHarness();
        h.service.registerTaskDefinitions([{ ...definition("npm"), properties: { script: { type: "string" } } }]);
        expect(h.service.taskIdentifierOf("build")).toBe("build");
        expect(h.service.taskIdentifierOf({ type: "npm", script: "x", extra: 1 })).toStrictEqual({
            type: "npm",
            script: "x",
            _key: "script,x,type,npm,",
        });
        expect(h.service.taskIdentifierOf({ task: "x" })).toBeUndefined();
        expect(h.service.taskIdentifierOf(null)).toBeUndefined();
        expect(h.service.taskIdentifierOf(3)).toBeUndefined();
        h.dispose();
    });

    it("taskIdentifierOf: a required property without a value — undefined and a warning", () => {
        const h = buildTaskServiceHarness();
        h.service.registerTaskDefinitions([
            { ...definition("npm"), required: ["o"], properties: { o: { type: "object" } } },
        ]);
        expect(h.service.taskIdentifierOf({ type: "npm" })).toBeUndefined();
        expect(h.logger.warn).toHaveBeenCalledTimes(1);
        h.dispose();
    });

    it("findTask — by label or definition key", () => {
        const h = buildTaskServiceHarness();
        const a = makeTask({ label: "a" });
        const b = makeTask({ label: "b", extension: ext("npm") });
        expect(h.service.findTask([a, b], "a")).toBe(a);
        expect(h.service.findTask([a, b], "Ext: b")).toBe(b);
        expect(h.service.findTask([a, b], b.definition)).toBe(b);
        expect(h.service.findTask([a, b], "zz")).toBeUndefined();
        h.dispose();
    });

    it("pickTask: items by label, sorted; picking returns the item with the task", async () => {
        const h = buildTaskServiceHarness();
        h.answerPicks("a");
        const entry = await h.service.pickTask([makeTask({ label: "b" }), makeTask({ label: "a" })], "Pick", {
            label: "None",
        });
        expect(h.picks[0].placeholder).toBe("Pick");
        expect(h.lastPickLabels()).toStrictEqual(["a", "b"]);
        expect(entry?.task?.name).toBe("a");
        h.dispose();
    });

    it("pickTask: empty — the default item; the extra one — only with several items", async () => {
        const h = buildTaskServiceHarness();
        await h.service.pickTask([], "P", { label: "None" }, { label: "All" });
        expect(h.lastPickLabels()).toStrictEqual(["None"]);
        await h.service.pickTask([makeTask({ label: "a" })], "P", { label: "None" }, { label: "All" });
        expect(h.lastPickLabels()).toStrictEqual(["a"]);
        await h.service.pickTask(
            [makeTask({ label: "a" }), makeTask({ label: "b" })],
            "P",
            { label: "None" },
            { label: "All" },
        );
        expect(h.lastPickLabels()).toStrictEqual(["a", "b", "All"]);
        await h.service.pickTask([makeTask({ label: "a" }), makeTask({ label: "b" })], "P", { label: "None" });
        expect(h.lastPickLabels()).toStrictEqual(["a", "b"]);
        h.dispose();
    });

    it("pickTask: task.quickOpen.skip and a single item — not shown", async () => {
        const h = buildTaskServiceHarness({ settings: { "task.quickOpen.skip": true } });
        const entry = await h.service.pickTask([makeTask({ label: "a" })], "P", { label: "None" });
        expect(entry?.task?.name).toBe("a");
        expect(h.picks).toStrictEqual([]);
        await h.service.pickTask([], "P", { label: "None" });
        expect(h.picks).toHaveLength(1);
        h.dispose();
    });

    it("taskEntries: equal ids are numbered; detail goes to the description with task.quickOpen.detail", () => {
        const h = buildTaskServiceHarness();
        const entries = h.service.taskEntries([
            makeTask({ label: "a", detail: "Details" }),
            makeTask({ label: "a" }),
            makeTask({ label: "b" }),
        ]);
        expect(entries.map((e) => [e.label, e.description])).toStrictEqual([
            ["a (1)", "Details"],
            ["a (2)", undefined],
            ["b", undefined],
        ]);
        expect(entries[2]).not.toHaveProperty("description");
        h.dispose();
        const off = buildTaskServiceHarness({ settings: { "task.quickOpen.detail": false } });
        expect(off.service.taskEntryBase(makeTask({ label: "a", detail: "D" }))).toStrictEqual({ label: "a" });
        off.dispose();
    });

    it("showRunningTasks: one — its terminal right away; none — the 'No task is running' picker", async () => {
        const h = buildTaskServiceHarness();
        await h.service.showRunningTasks();
        expect(h.picks[0].placeholder).toBe("Select the task to show its output");
        expect(h.lastPickLabels()).toStrictEqual(["No task is running"]);
        void h.service.run(makeTask({ presentation: { reveal: "never" } }));
        await vi.waitFor(() => {
            expect(h.sessions).toHaveLength(1);
        });
        await h.service.showRunningTasks();
        expect(h.views.panelService.visible).toBe(true);
        expect(h.picks).toHaveLength(1);
        h.dispose();
    });

    it("showRunningTasks: several in one group — the first; in different ones — the picker and the picked one", async () => {
        const h = buildTaskServiceHarness();
        const grouped = { reveal: "never" as const, panel: "new" as const, group: "g" };
        void h.service.run(makeTask({ label: "a", presentation: grouped }));
        void h.service.run(makeTask({ label: "b", presentation: grouped }));
        await vi.waitFor(() => {
            expect(h.sessions).toHaveLength(2);
        });
        await h.service.showRunningTasks();
        expect(h.picks).toHaveLength(0);
        expect(h.terminals.getActiveInstance()?.id).toBe(1);
        void h.service.run(makeTask({ label: "c", presentation: { ...DEFAULT_PRESENTATION, reveal: "never" } }));
        await vi.waitFor(() => {
            expect(h.sessions).toHaveLength(3);
        });
        h.answerPicks("b");
        await h.service.showRunningTasks();
        expect(h.lastPickLabels()).toStrictEqual(["a", "b", "c"]);
        expect(h.terminals.getActiveInstance()?.id).toBe(2);
        h.answerPicks(undefined);
        await h.service.showRunningTasks();
        expect(h.terminals.getActiveInstance()?.id).toBe(2);
        h.dispose();
    });

    it("showRunningTasks: several without a group — the picker", async () => {
        const h = buildTaskServiceHarness();
        h.answerPicks(undefined);
        void h.service.run(makeTask({ label: "a", presentation: { reveal: "never" } }));
        void h.service.run(makeTask({ label: "b", presentation: { reveal: "never" } }));
        await vi.waitFor(() => {
            expect(h.sessions).toHaveLength(2);
        });
        await h.service.showRunningTasks();
        expect(h.lastPickLabels()).toStrictEqual(["a", "b"]);
        h.dispose();
    });

    it("showRunningTasks: only the first has a group — the picker", async () => {
        const h = buildTaskServiceHarness();
        void h.service.run(makeTask({ label: "a", presentation: { reveal: "never", group: "g" } }));
        void h.service.run(makeTask({ label: "b", presentation: { reveal: "never", panel: "new" } }));
        await vi.waitFor(() => {
            expect(h.sessions).toHaveLength(2);
        });
        await h.service.showRunningTasks();
        expect(h.picks).toHaveLength(1);
        h.dispose();
    });

    it("pty bridge for CustomExecution: unregistering returns the 'extension host required' refusal", async () => {
        const h = buildTaskServiceHarness();
        const registration = h.service.setCustomExecutionTerminals({ createPtyInstance: () => 1 });
        registration.dispose();
        await expect(
            h.service.run(makeTask({ command: { runtime: "custom" }, extension: ext("custom") })),
        ).rejects.toThrow("Tasks with a custom execution need the extension host, which is not running.");
        h.dispose();
    });
});
