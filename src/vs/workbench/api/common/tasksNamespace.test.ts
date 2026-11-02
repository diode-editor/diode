import { afterEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { CancellationTokenSource as CoreCancellationTokenSource } from "../../../base/common/cancellation.ts";

import { createTasksNamespace, taskToWire } from "./tasksNamespace.ts";
import type { IWireTask, IWireTaskExecution } from "./taskWireTypes.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner } from "./vscodeHostContext.ts";
import {
    CustomExecution,
    EventEmitter,
    ProcessExecution,
    ShellExecution,
    Task,
    TaskGroup,
    TaskScope,
    Uri,
} from "./vscodeTypes.ts";
import type { IWireExtensionDescription } from "./wireTypes.ts";

const FOLDER = { uri: Uri.file("/ws"), name: "ws", index: 0 } as unknown as vscode.WorkspaceFolder;

async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

function setup(folders: () => readonly vscode.WorkspaceFolder[] | undefined = () => [FOLDER]) {
    const stub = makeStubRpc();
    const owner = new ExtensionOwner();
    const catalog = new EventEmitter<readonly IWireExtensionDescription[]>();
    const attachPty = vi.fn();
    const ns = createTasksNamespace({
        rpc: stub.rpc,
        owner,
        workspaceFolders: folders,
        attachPty,
        onDidReceiveCatalog: catalog.event,
    });
    const sent = (method: string): unknown[] => stub.notifies.filter((n) => n.method === method).map((n) => n.params);
    const requested = (method: string): unknown[] =>
        stub.requests.filter((r) => r.method === method).map((r) => r.params);
    const events: string[] = [];
    ns.onDidStartTask((e) => events.push(`start:${e.execution.task.name}`));
    ns.onDidEndTask((e) => events.push(`end:${e.execution.task.name}`));
    ns.onDidStartTaskProcess((e) => events.push(`pstart:${e.execution.task.name}:${String(e.processId)}`));
    ns.onDidEndTaskProcess((e) => events.push(`pend:${e.execution.task.name}:${String(e.exitCode)}`));
    // Raw events — including those without an execution (the listeners above would throw on them).
    const raw: object[] = [];
    const record = (e: object): void => {
        raw.push(e);
    };
    ns.onDidStartTask(record);
    ns.onDidEndTask(record);
    ns.onDidStartTaskProcess(record);
    ns.onDidEndTaskProcess(record);
    return { stub, owner, catalog, attachPty, ns, sent, requested, events, raw };
}

const wireTask = (overrides: Partial<IWireTask> = {}): IWireTask => ({
    name: "build",
    execution: { commandLine: "make" },
    definition: { type: "demo", target: "a" },
    isBackground: false,
    source: { label: "demo", extensionId: "pub.ext", scope: 2 },
    problemMatchers: [],
    hasDefinedMatchers: false,
    ...overrides,
});

const execution = (id: string, task: IWireTask = wireTask()): IWireTaskExecution => ({ id, task });

afterEach(() => {
    vi.restoreAllMocks();
});

describe("tasks.registerTaskProvider", () => {
    it("registration is sent with handle, type and owner; dispose removes it", () => {
        const s = setup();
        const provider = { provideTasks: () => [], resolveTask: () => undefined };
        const a = s.owner.runAs("pub.a", () => s.ns.registerTaskProvider("npm", provider));
        s.ns.registerTaskProvider("gulp", provider);
        expect(s.sent("tasks.registerProvider")).toStrictEqual([
            { handle: 0, type: "npm", extensionId: "pub.a" },
            { handle: 1, type: "gulp", extensionId: "" },
        ]);
        a.dispose();
        expect(s.sent("tasks.unregisterProvider")).toStrictEqual([{ handle: 0 }]);
    });

    it("tasks.provideTasks: provider tasks as descriptions with its extension; token is a vscode token", async () => {
        const s = setup();
        const seen: vscode.CancellationToken[] = [];
        s.owner.runAs("pub.ext", () =>
            s.ns.registerTaskProvider("demo", {
                provideTasks: (token) => {
                    seen.push(token);
                    return [
                        new Task(
                            { type: "demo", target: "a" },
                            TaskScope.Workspace,
                            "build",
                            "demo",
                            new ShellExecution("make"),
                        ),
                    ];
                },
                resolveTask: () => undefined,
            }),
        );
        const result = (await s.stub.callRequest("tasks.provideTasks", { handle: 0 })) as IWireTask[];
        expect(result.map((t) => [t.name, t.source.extensionId, t.execution])).toStrictEqual([
            ["build", "pub.ext", { commandLine: "make" }],
        ]);
        expect(typeof seen[0].isCancellationRequested).toBe("boolean");
        const cancel = new CoreCancellationTokenSource();
        cancel.cancel();
        await s.stub.callRequest("tasks.provideTasks", { handle: 0 }, cancel.token);
        expect(seen[1].isCancellationRequested).toBe(true);
    });

    it("tasks.provideTasks: empty provider answer yields empty; unknown handle is rejected", async () => {
        const s = setup();
        s.ns.registerTaskProvider("demo", { provideTasks: () => undefined, resolveTask: () => undefined });
        await expect(s.stub.callRequest("tasks.provideTasks", { handle: 0 })).resolves.toStrictEqual([]);
        await expect(s.stub.callRequest("tasks.provideTasks", { handle: 9 })).rejects.toThrow("no handler found");
    });

    it("removed provider is no longer asked", async () => {
        const s = setup();
        const registration = s.ns.registerTaskProvider("demo", {
            provideTasks: () => [],
            resolveTask: () => undefined,
        });
        registration.dispose();
        await expect(s.stub.callRequest("tasks.provideTasks", { handle: 0 })).rejects.toThrow("no handler found");
    });

    it("provider shell task does not look for a pty on start, no errors", async () => {
        const s = setup();
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
        s.ns.registerTaskProvider("demo", {
            provideTasks: () => [
                new Task({ type: "demo", target: "a" }, FOLDER, "build", "demo", new ShellExecution("make")),
            ],
            resolveTask: () => undefined,
        });
        const [wire] = (await s.stub.callRequest("tasks.provideTasks", { handle: 0 })) as IWireTask[];
        s.stub.fire("tasks.didStart", { execution: execution("pub.ext.target,a,type,demo,", wire), terminalId: 1 });
        s.stub.fire("tasks.didStart", { execution: execution(".target,a,type,demo,", wire), terminalId: 1 });
        await settle();
        expect(errors).not.toHaveBeenCalled();
        expect(s.attachPty).not.toHaveBeenCalled();
    });
});

describe("tasks.fetchTasks", () => {
    it("request with or without type; descriptions → Task with core id, scope and fields", async () => {
        const s = setup();
        s.stub.responder = () => [
            wireTask({
                id: "core-1",
                isBackground: true,
                group: { id: "build", isDefault: true },
                presentationOptions: { reveal: 2 },
                runOptions: { reevaluateOnRerun: false },
                detail: "d",
                problemMatchers: ["$m"],
                definition: { type: "demo", target: "a", _key: "x" } as never,
            }),
            wireTask({
                id: "core-2",
                name: "folder",
                source: { label: "demo", extensionId: "e", scope: { folder: "/ws" } },
            }),
            wireTask({ id: "core-3", source: { label: "demo", extensionId: "e", scope: { folder: "/gone" } } }),
            { bogus: true },
        ];
        const tasks = await s.ns.fetchTasks({ type: "demo" });
        await s.ns.fetchTasks();
        expect(s.requested("tasks.fetch")).toStrictEqual([{ type: "demo" }, {}]);
        expect(tasks).toHaveLength(2);
        const [first, second] = tasks as Task[];
        expect([first.handleId, first.name, first.source, first.scope, first.definition]).toStrictEqual([
            "core-1",
            "build",
            "demo",
            TaskScope.Workspace,
            { type: "demo", target: "a" },
        ]);
        expect([
            first.isBackground,
            first.detail,
            first.problemMatchers,
            first.runOptions,
            first.presentationOptions,
        ]).toStrictEqual([true, "d", ["$m"], { reevaluateOnRerun: false }, { reveal: 2 }]);
        expect([first.group?.id, first.group?.isDefault, first.group === TaskGroup.Build]).toStrictEqual([
            "build",
            true,
            false,
        ]);
        expect(first.execution).toBeInstanceOf(ShellExecution);
        expect(second.scope).toBe(FOLDER);
    });

    it("executions from descriptions: process, shell with command, without command; non-built-in group", async () => {
        const s = setup();
        s.stub.responder = () => [
            wireTask({
                id: "p",
                execution: { process: "node", args: ["a"], options: { cwd: "/c" } },
                group: { id: "build" },
            }),
            wireTask({
                id: "c",
                execution: { command: { value: "x", quoting: 1 }, args: ["y"] },
                group: { id: "lint" },
            }),
            wireTask({ id: "n", execution: {} }),
            wireTask({ id: "u", execution: undefined }),
            wireTask({ id: "s", execution: { command: "sh" } }),
        ];
        const [p, c, n, u, bare] = await s.ns.fetchTasks();
        expect(p.execution).toBeInstanceOf(ProcessExecution);
        expect((p.execution as ProcessExecution).args).toStrictEqual(["a"]);
        expect(p.group).toBe(TaskGroup.Build);
        expect((c.execution as ShellExecution).command).toStrictEqual({ value: "x", quoting: 1 });
        expect((c.execution as ShellExecution).args).toStrictEqual(["y"]);
        expect((bare.execution as ShellExecution).command).toBe("sh");
        expect((bare.execution as ShellExecution).args).toStrictEqual([]);
        expect([c.group?.id, (c.group as TaskGroup | undefined)?.label]).toStrictEqual(["lint", "lint"]);
        expect([n.execution, u.execution]).toStrictEqual([undefined, undefined]);
    });
});

describe("tasks.executeTask", () => {
    it("own new task: whole description, id from the core formula per catalog schema; execution is the same object", async () => {
        const s = setup();
        s.catalog.fire([
            {
                id: "pub.ext",
                extensionPath: "/e",
                isActive: true,
                packageJSON: {
                    contributes: { taskDefinitions: [{ type: "demo", properties: { target: { type: "string" } } }] },
                },
            },
            { id: "pub.other", extensionPath: "/o", isActive: true, packageJSON: {} },
        ]);
        const task = new Task(
            { type: "demo", target: "a", extra: 1 },
            FOLDER,
            "build",
            "demo",
            new ShellExecution("make"),
        );
        const result = await s.owner.runAs("pub.ext", () => s.ns.executeTask(task));
        expect(result.task).toBe(task);
        const [request] = s.requested("tasks.execute") as { task: IWireTask }[];
        expect(request.task.source).toStrictEqual({ label: "demo", extensionId: "pub.ext", scope: { folder: "/ws" } });
        expect(s.ns.taskExecutions).toStrictEqual([result]);
        // A start with this id is the same execution, without rebuilding the task.
        s.stub.fire("tasks.didStart", { execution: execution("pub.ext.target,a,type,demo,"), terminalId: 1 });
        await settle();
        expect(s.events).toStrictEqual(["start:build"]);
        result.terminate();
        expect(s.sent("tasks.terminate")).toStrictEqual([{ id: "pub.ext.target,a,type,demo," }]);
    });

    it("core task goes by its id; an already known execution is reused", async () => {
        const s = setup();
        s.stub.responder = (method) => (method === "tasks.fetch" ? [wireTask({ id: "core-1" })] : undefined);
        const [task] = await s.ns.fetchTasks();
        const first = await s.ns.executeTask(task);
        const second = await s.ns.executeTask(task);
        expect(s.requested("tasks.execute")).toStrictEqual([{ id: "core-1" }, { id: "core-1" }]);
        expect(second).toBe(first);
    });

    it("task with core id but no execution runs by id", async () => {
        const s = setup();
        const task = new Task({ type: "demo" }, FOLDER, "n", "s");
        task.handleId = "core-2";
        await s.ns.executeTask(task);
        expect(s.requested("tasks.execute")).toStrictEqual([{ id: "core-2" }]);
    });

    it("own shell task: no pty lookup on start, no errors", async () => {
        const s = setup();
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const task = new Task({ type: "demo", target: "sh" }, FOLDER, "sh", "demo", new ShellExecution("make"));
        await s.owner.runAs("pub.ext", () => s.ns.executeTask(task));
        s.stub.fire("tasks.didStart", { execution: execution("pub.ext.target,sh,type,demo,"), terminalId: 1 });
        await settle();
        expect(errors).not.toHaveBeenCalled();
        expect(s.attachPty).not.toHaveBeenCalled();
        expect(s.events).toStrictEqual(["start:sh"]);
    });

    it("host refusal: a new execution is forgotten, a known one is not", async () => {
        const s = setup();
        s.stub.responder = (method) => {
            if (method === "tasks.fetch") return [wireTask({ id: "core-1" })];
            return Promise.reject(new Error("Task not found"));
        };
        const [task] = await s.ns.fetchTasks();
        await expect(s.ns.executeTask(task)).rejects.toThrow("Task not found");
        expect(s.ns.taskExecutions).toStrictEqual([]);
        s.stub.fire("tasks.didStart", { execution: execution("core-1"), terminalId: 1 });
        await settle();
        await expect(s.ns.executeTask(task)).rejects.toThrow("Task not found");
        expect(s.ns.taskExecutions).toHaveLength(1);
    });

    it("a task literal that is not our Task class has no handle: it executes by its wire form", async () => {
        const s = setup();
        const task = {
            name: "lit",
            definition: { type: "demo" },
            scope: TaskScope.Workspace,
            source: "demo",
            isBackground: false,
            execution: new ShellExecution("make"),
            presentationOptions: {},
            problemMatchers: [],
            runOptions: {},
        } as unknown as vscode.Task;

        const result = await s.ns.executeTask(task);

        expect(result.task).toBe(task);
        const [request] = s.requested("tasks.execute") as { task: IWireTask }[];
        expect(request.task).toMatchObject({
            name: "lit",
            execution: { commandLine: "make" },
            hasDefinedMatchers: false,
        });
        expect(request.task.id).toBeUndefined();
    });

    it("no execution and no id is rejected without a request; invalid definition yields the 'execute only' key", async () => {
        const s = setup();
        await expect(s.ns.executeTask(new Task({ type: "demo" }, FOLDER, "x", "demo"))).rejects.toThrow(
            "Tasks to execute must include an execution",
        );
        expect(s.requested("tasks.execute")).toStrictEqual([]);
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
        s.catalog.fire([
            {
                id: "pub.ext",
                extensionPath: "/e",
                isActive: true,
                packageJSON: {
                    contributes: {
                        taskDefinitions: [
                            { type: "demo", required: ["o"], properties: { o: { type: "object" } } },
                            { bad: 1 },
                        ],
                    },
                },
            },
        ]);
        const result = await s.ns.executeTask(new Task({ type: "demo" }, FOLDER, "x", "demo", new ShellExecution("x")));
        expect((result as unknown as { id: string }).id).toMatch(/^\.[0-9a-f-]{36}$/u);
        expect(errors.mock.calls.map((c) => String(c[0]))).toStrictEqual([
            "[ext-host] The task type configuration is missing the required 'taskType' property",
            `[ext-host] Error: the task identifier '{"type":"demo"}' is missing the required property 'o'. The task identifier will be ignored.`,
        ]);
    });
});

describe("execution events", () => {
    it("task start from the command palette: new Task from description; process, end; taskExecutions", async () => {
        const s = setup();
        s.stub.fire("tasks.didStart", {
            execution: execution("x"),
            terminalId: 4,
            resolvedDefinition: { type: "demo" },
        });
        s.stub.fire("tasks.didStartProcess", { id: "x", processId: 42 });
        await settle();
        expect(s.ns.taskExecutions.map((e) => [e.task.name, e.task.source, e.task.scope])).toStrictEqual([
            ["build", "demo", TaskScope.Workspace],
        ]);
        s.stub.fire("tasks.didEndProcess", { id: "x", exitCode: 3 });
        s.stub.fire("tasks.didEndProcess", { id: "x" });
        s.stub.fire("tasks.didEnd", { execution: execution("x") });
        await settle();
        expect(s.events).toStrictEqual([
            "start:build",
            "pstart:build:42",
            "pend:build:3",
            "pend:build:undefined",
            "end:build",
        ]);
        expect(s.ns.taskExecutions).toStrictEqual([]);
    });

    it("unknown and malformed messages are skipped; task outside folders has no events, logs a message", async () => {
        const s = setup();
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
        s.stub.fire("tasks.didStart", { execution: { id: 1 } });
        s.stub.fire("tasks.didStart", {
            terminalId: 1,
            execution: execution(
                "x",
                wireTask({ source: { label: "d", extensionId: "e", scope: { folder: "/gone" } } }),
            ),
        });
        s.stub.fire("tasks.didStartProcess", { id: "nope", processId: 1 });
        s.stub.fire("tasks.didStartProcess", { id: 1 });
        s.stub.fire("tasks.didEndProcess", { id: "nope", exitCode: 1 });
        s.stub.fire("tasks.didEndProcess", null);
        s.stub.fire("tasks.didEnd", { execution: execution("nope") });
        s.stub.fire("tasks.didEnd", { execution: null });
        await settle();
        expect(s.events).toStrictEqual([]);
        expect(s.raw).toStrictEqual([]);
        expect(errors.mock.calls.map((c) => String(c[0]))).toStrictEqual([
            '[ext-host] task "build" started outside of the workspace folders; its events are skipped',
        ]);
    });

    it("workspace without folders: a folder task is outside folders, no events", async () => {
        const s = setup(() => undefined);
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
        s.stub.fire("tasks.didStart", {
            terminalId: 1,
            execution: execution("x", wireTask({ source: { label: "d", extensionId: "e", scope: { folder: "/ws" } } })),
        });
        await settle();
        expect(s.raw).toStrictEqual([]);
        expect(errors.mock.calls.map((c) => String(c[0]))).toStrictEqual([
            '[ext-host] task "build" started outside of the workspace folders; its events are skipped',
        ]);
    });

    it("message handling failure (description does not build a Task) writes to stderr, the queue continues", async () => {
        const s = setup();
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
        s.stub.fire("tasks.didStart", {
            execution: execution("bad", wireTask({ source: { label: "", extensionId: "e", scope: 2 } })),
            terminalId: 1,
        });
        s.stub.fire("tasks.didStart", { execution: execution("x"), terminalId: 1 });
        await settle();
        expect(s.events).toStrictEqual(["start:build"]);
        expect(String(errors.mock.calls[0][0])).toMatch(
            /^\[ext-host\] task event handler failed: Error: Illegal argument: source must be a string of length > 0/u,
        );
    });
});

describe("CustomExecution", () => {
    const pty = (): vscode.Pseudoterminal => ({
        onDidWrite: new EventEmitter<string>().event,
        open: () => undefined,
        close: () => undefined,
    });

    it("provider task: on start the callback gets the resolved definition, pty goes to the task terminal; start comes after", async () => {
        const s = setup();
        const order: string[] = [];
        const callback = vi.fn(async (definition: vscode.TaskDefinition) => {
            order.push(`callback:${String(definition.target)}`);
            await Promise.resolve();
            return pty();
        });
        s.attachPty.mockImplementation((id: number) => order.push(`attach:${String(id)}`));
        s.ns.onDidStartTask(() => order.push("start"));
        s.owner.runAs("pub.ext", () =>
            s.ns.registerTaskProvider("demo", {
                provideTasks: () => [
                    new Task(
                        { type: "demo", target: "${x}" },
                        TaskScope.Workspace,
                        "pty",
                        "demo",
                        new CustomExecution(callback),
                    ),
                ],
                resolveTask: () => undefined,
            }),
        );
        const [wire] = (await s.stub.callRequest("tasks.provideTasks", { handle: 0 })) as IWireTask[];
        expect(wire.execution).toStrictEqual({ customExecution: "customExecution" });
        s.stub.fire("tasks.didStart", {
            execution: execution("pub.ext.target,${x},type,demo,", wire),
            terminalId: 7,
            resolvedDefinition: { type: "demo", target: "resolved" },
        });
        s.stub.fire("tasks.didStartProcess", { id: "pub.ext.target,${x},type,demo,", processId: -1 });
        await settle();
        expect(order).toStrictEqual(["callback:resolved", "attach:7", "start"]);
        expect(s.events).toStrictEqual(["start:pty", "pstart:pty:-1"]);
        // A core task with this id gets the same callback.
        s.stub.responder = () => [
            wireTask({ id: "pub.ext.target,${x},type,demo,", execution: { customExecution: "customExecution" } }),
        ];
        const [fetched] = await s.ns.fetchTasks();
        expect((fetched.execution as CustomExecution).callback).toBe(callback);
    });

    it("own executeTask task: callback by id; without a definition in start, the task definition", async () => {
        const s = setup();
        const callback = vi.fn(() => Promise.resolve(pty()));
        const task = new Task({ type: "demo", target: "own" }, FOLDER, "own", "demo", new CustomExecution(callback));
        await s.owner.runAs("pub.ext", () => s.ns.executeTask(task));
        s.stub.fire("tasks.didStart", { execution: execution("pub.ext.target,own,type,demo,"), terminalId: 2 });
        await settle();
        expect(callback).toHaveBeenCalledWith({ type: "demo", target: "a" });
        expect(s.attachPty).toHaveBeenCalledWith(2, expect.anything());
    });

    it("callback failure logs a message, start still arrives", async () => {
        const s = setup();
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const task = new Task(
            { type: "demo", target: "b" },
            FOLDER,
            "bad",
            "demo",
            new CustomExecution(() => Promise.reject(new Error("no pty"))),
        );
        await s.owner.runAs("pub.ext", () => s.ns.executeTask(task));
        s.stub.fire("tasks.didStart", { execution: execution("pub.ext.target,b,type,demo,"), terminalId: 3 });
        await settle();
        expect(s.attachPty).not.toHaveBeenCalled();
        expect(s.events).toStrictEqual(["start:bad"]);
        expect(String(errors.mock.calls[0][0])).toMatch(
            /^\[ext-host\] CustomExecution of task "build" failed: Error: no pty/u,
        );
    });
});

describe("taskToWire", () => {
    it("task fields: scope, group, execution options, matchers", () => {
        const task = new Task(
            { type: "demo" },
            TaskScope.Global,
            "n",
            "s",
            new ProcessExecution("node", ["a"], { cwd: "/c" }),
            "$m",
        );
        const group = new TaskGroup("build", "Build");
        group.isDefault = true;
        task.group = group;
        task.detail = "d";
        // presentation/runOptions are prototype-less objects (as upstream): hence toEqual.
        expect(taskToWire(task, "e")).toEqual({
            name: "n",
            execution: { process: "node", args: ["a"], options: { cwd: "/c" } },
            definition: { type: "demo" },
            isBackground: false,
            source: { label: "s", extensionId: "e", scope: TaskScope.Global },
            group: { id: "build", isDefault: true },
            detail: "d",
            presentationOptions: {},
            problemMatchers: ["$m"],
            hasDefinedMatchers: true,
            runOptions: {},
        });
        const deprecated = new Task({ type: "demo" }, "n", "s", new ShellExecution("c", ["x"], { cwd: "/c" }));
        expect(taskToWire(deprecated, "e")).toMatchObject({
            execution: { command: "c", args: ["x"], options: { cwd: "/c" } },
            source: { scope: TaskScope.Workspace },
        });
        expect(
            taskToWire(new Task({ type: "demo" }, FOLDER, "n", "s", new ProcessExecution("p")), "e").execution,
        ).toStrictEqual({
            process: "p",
            args: [],
        });
        expect(taskToWire(new Task({ type: "demo" }, FOLDER, "n", "s"), "e").execution).toBeUndefined();
        expect(taskToWire(new Task({ type: "demo" }, FOLDER, "n", "s"), "e")).not.toHaveProperty("group");
    });

    it("core id only for our task with handleId; empty group/isDefault/detail have no keys", () => {
        const task = new Task({ type: "demo" }, FOLDER, "n", "s", new ShellExecution("c"));
        const plain = taskToWire(task, "e");
        expect(Object.keys(plain)).not.toContain("id");
        expect(Object.keys(plain)).not.toContain("detail");
        task.group = new TaskGroup("test", "Test");
        task.handleId = "core-1";
        const keyed = taskToWire(task, "e");
        expect(keyed.id).toBe("core-1");
        expect(keyed.group).toStrictEqual({ id: "test" });
    });

    it("foreign task shape (not our class): matchers by length, no id", () => {
        const shape = {
            name: "n",
            source: "s",
            definition: { type: "t" },
            scope: TaskScope.Workspace,
            execution: undefined,
            isBackground: false,
            presentationOptions: {},
            problemMatchers: ["$x"],
            runOptions: {},
        };
        const foreign = shape as unknown as vscode.Task;
        expect(taskToWire(foreign, "e")).toMatchObject({ hasDefinedMatchers: true });
        expect(taskToWire({ ...shape, problemMatchers: [] } as unknown as vscode.Task, "e")).toMatchObject({
            hasDefinedMatchers: false,
        });
        expect(taskToWire(foreign, "e")).not.toHaveProperty("id");
    });
});
