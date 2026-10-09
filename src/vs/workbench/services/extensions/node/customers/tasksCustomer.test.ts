import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { FakeExtensionPtySession } from "../../../../../../TestUtils/FakeExtensionPtySession.ts";
import { buildTaskServiceHarness } from "../../../../../../TestUtils/taskServiceHarness.ts";
import { createLoggerSpy } from "../../../../../../TestUtils/themeExtensionFixture.ts";
import { Uri } from "../../../../../base/common/uri.ts";
import type { IExtension } from "../../../../../platform/extensions/common/iExtension.ts";
import type { HostRpc, SubprocessRpc } from "../../../../api/common/extHostProtocol.ts";
import type { IExtensionTaskSink } from "../../../../api/common/iExtensionTaskSink.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import { createTasksNamespace } from "../../../../api/common/tasksNamespace.ts";
import { createTerminalNamespace } from "../../../../api/common/terminalNamespace.ts";
import { ExtensionOwner } from "../../../../api/common/vscodeHostContext.ts";
import {
    CustomExecution,
    EventEmitter,
    ProcessExecution,
    ShellExecution,
    Task,
    TaskScope,
} from "../../../../api/common/vscodeTypes.ts";
import type { IWireExtensionDescription } from "../../../../api/common/wireTypes.ts";
import { bindExtensionTasks, ExtensionTaskAdapter } from "../../../../contrib/tasks/browser/extensionTaskAdapter.ts";
import { ExtensionTerminalAdapter } from "../../../../contrib/terminal/browser/extensionTerminalAdapter.ts";
import type { IExtensionService } from "../../common/extensions.ts";

import { TasksCustomer } from "./tasksCustomer.ts";
import { TerminalCustomer } from "./terminalCustomer.ts";

// Сквозняк контракта задач на одном процессе: `vscode.tasks` субпроцесса
// (`createTasksNamespace` + терминальная часть для pty) ↔ настоящий RPC ↔
// `TasksCustomer`/`TerminalCustomer` ↔ мосты ↔ настоящий `TaskService` с
// терминалом на фейковых сессиях. Расширение — синтетическое, формой
// провайдера bazel-java: `new Task(def, TaskScope.Workspace, name, source,
// new ShellExecution(cmd))`.

const EXT = "pub.demo";
const FOLDER: vscode.WorkspaceFolder = { uri: Uri.file("/ws") as unknown as vscode.Uri, name: "ws", index: 0 };

async function flush(): Promise<void> {
    for (let i = 0; i < 8; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

function setup() {
    const h = buildTaskServiceHarness();
    const ptySessions: FakeExtensionPtySession[] = [];
    const terminalAdapter = new ExtensionTerminalAdapter(h.terminals, h.views.panelService, (o) => {
        const session = new FakeExtensionPtySession(o);
        ptySessions.push(session);
        return session;
    });
    const taskAdapter = new ExtensionTaskAdapter(
        h.service,
        { getWorkspace: () => ({ id: "ws", folders: [{ uri: Uri.file("/ws"), name: "ws", index: 0 }] }) } as never,
        h.logger,
    );
    const activated: string[] = [];
    const extensionService = {
        extensions: [
            {
                id: EXT,
                manifest: {
                    contributes: {
                        taskDefinitions: [
                            { type: "demo", required: ["target"], properties: { target: { type: "string" } } },
                        ],
                    },
                },
            } as unknown as IExtension,
        ],
        whenInstalledExtensionsRegistered: () => Promise.resolve(),
        activateByEvent: (event: string) => {
            activated.push(event);
            return Promise.resolve();
        },
    } as unknown as IExtensionService;
    bindExtensionTasks(h.service, extensionService, terminalAdapter, h.logger);
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a) as unknown as HostRpc;
    const subRpc = new RpcEndpoint(b) as unknown as SubprocessRpc;
    const owner = new ExtensionOwner();
    const terminals = createTerminalNamespace(subRpc);
    const catalog = new EventEmitter<readonly IWireExtensionDescription[]>();
    const tasks = createTasksNamespace({
        rpc: subRpc,
        owner,
        workspaceFolders: () => [FOLDER],
        attachPty: (id, pty) => {
            terminals.attachPty(id, pty);
        },
        onDidReceiveCatalog: catalog.event,
    });
    catalog.fire([
        {
            id: EXT,
            extensionPath: "/ext",
            isActive: true,
            packageJSON: {
                contributes: {
                    taskDefinitions: [
                        { type: "demo", required: ["target"], properties: { target: { type: "string" } } },
                    ],
                },
            },
        },
    ]);
    const terminalCustomer = new TerminalCustomer(terminalAdapter);
    const terminalAttach = terminalCustomer.attach({ rpc: hostRpc, logger: undefined });
    terminalCustomer.pushInitialState();
    const tasksAttach = new TasksCustomer(taskAdapter).attach({ rpc: hostRpc, logger: undefined });
    const events: string[] = [];
    const label = (e: vscode.TaskExecution): string => `${e.task.source}/${e.task.name}`;
    tasks.onDidStartTask((e) => events.push(`start:${label(e.execution)}`));
    tasks.onDidEndTask((e) => events.push(`end:${label(e.execution)}`));
    tasks.onDidStartTaskProcess((e) => events.push(`pstart:${label(e.execution)}:${String(e.processId)}`));
    tasks.onDidEndTaskProcess((e) => events.push(`pend:${label(e.execution)}:${String(e.exitCode)}`));
    const shellTask = (target: string, command: string): vscode.Task =>
        new Task({ type: "demo", target }, TaskScope.Workspace, target, "demo", new ShellExecution(command));
    const register = (provider: Pick<vscode.TaskProvider, "provideTasks">): vscode.Disposable =>
        owner.runAs(EXT, () => tasks.registerTaskProvider("demo", { resolveTask: () => undefined, ...provider }));
    const dispose = (): void => {
        tasksAttach.dispose();
        terminalAttach.dispose();
        h.dispose();
    };
    return {
        h,
        tasks,
        terminals,
        owner,
        events,
        activated,
        ptySessions,
        shellTask,
        register,
        hostRpc,
        subRpc,
        dispose,
    };
}

describe("vscode.tasks — сквозь провод", () => {
    it("провайдер расширения: его задачи в списке ядра с подписью «source: name», id — расширение и ключ определения", async () => {
        const s = setup();
        const registration = s.register({ provideTasks: () => [s.shellTask("ok", "echo ok")] });
        await flush();
        const [task] = await s.h.service.tasks({ type: "demo" });
        expect(task._label).toBe("demo: ok");
        expect(task._id).toBe(`${EXT}.target,ok,type,demo,`);
        expect(task.source).toMatchObject({ kind: "extension", label: "demo", extensionId: EXT, scope: "folder" });
        expect(task.command).toMatchObject({ runtime: "shell", name: "echo ok" });
        // Run Task поднял провайдеров: onCommand runTask + onTaskType типа.
        expect(s.activated).toStrictEqual(["onCommand:workbench.action.tasks.runTask", "onTaskType:demo"]);
        registration.dispose();
        await flush();
        expect(await s.h.service.tasks({ type: "demo" })).toStrictEqual([]);
        s.dispose();
    });

    it("задача провайдера, запущенная из палитры: расширение видит Start/ProcessStart/ProcessEnd/End с name и source задачи", async () => {
        const s = setup();
        s.register({ provideTasks: () => [s.shellTask("build", "make")] });
        await flush();
        const [task] = await s.h.service.tasks({ type: "demo" });
        void s.h.service.run(task);
        await flush();
        expect(s.events).toStrictEqual(["start:demo/build", "pstart:demo/build:100"]);
        // Так bazel-java ищет свою бегущую задачу: по name + source в taskExecutions.
        const running = s.tasks.taskExecutions.find((e) => e.task.name === "build" && e.task.source === "demo");
        expect(running?.task.definition).toStrictEqual({ type: "demo", target: "build" });
        expect(running?.task.scope).toBe(FOLDER);
        expect(running?.task.execution).toBeInstanceOf(ShellExecution);
        s.h.sessions[0].emitExit(2);
        await flush();
        expect(s.events.slice(2)).toStrictEqual(["pend:demo/build:2", "end:demo/build"]);
        expect(s.tasks.taskExecutions).toStrictEqual([]);
        s.dispose();
    });

    it("executeTask своей задачи: в событиях — тот же объект; ядро исполняет её командой", async () => {
        const s = setup();
        const own = s.owner.runAs(EXT, () => s.shellTask("own", "echo own"));
        const starts: vscode.TaskStartEvent[] = [];
        s.tasks.onDidStartTask((e) => starts.push(e));
        const execution = await s.owner.runAs(EXT, () => s.tasks.executeTask(own));
        await flush();
        expect(execution.task).toBe(own);
        expect(starts[0].execution).toBe(execution);
        expect(s.tasks.taskExecutions).toStrictEqual([execution]);
        expect(s.h.terminals.getInstances()[0].launch.shellArgs).toStrictEqual(["-c", "echo own"]);
        // Ключ по схеме типа из каталога — и у ядра, и у субпроцесса.
        expect(s.h.service.getActiveTasks()[0]._id).toBe(`${EXT}.target,own,type,demo,`);
        s.dispose();
    });

    it("fetchTasks: задачи ядра с его id; исполнение такой — по id, изменённой — описанием", async () => {
        const s = setup();
        s.register({ provideTasks: () => [s.shellTask("a", "echo a")] });
        await flush();
        const fetched = await s.tasks.fetchTasks({ type: "demo" });
        expect(fetched.map((t) => [t.name, t.source, (t as Task).handleId])).toStrictEqual([
            ["a", "demo", `${EXT}.target,a,type,demo,`],
        ]);
        const all = await s.tasks.fetchTasks();
        expect(all).toHaveLength(1);
        const execution = await s.tasks.executeTask(fetched[0]);
        await flush();
        expect(execution.task).toBe(fetched[0]);
        expect(s.events[0]).toBe("start:demo/a");
        s.h.sessions[0].emitExit(0);
        await flush();
        fetched[0].execution = new ShellExecution("echo changed");
        expect((fetched[0] as Task).handleId).toBeUndefined();
        await s.owner.runAs(EXT, () => s.tasks.executeTask(fetched[0]));
        await flush();
        expect(s.h.sessions[0].relaunches.at(-1)?.args).toStrictEqual(["-c", "echo changed"]);
        s.dispose();
    });

    it("TaskExecution.terminate закрывает терминал задачи; конец приходит расширению", async () => {
        const s = setup();
        const execution = await s.owner.runAs(EXT, () => s.tasks.executeTask(s.shellTask("long", "sleep 100")));
        await flush();
        execution.terminate();
        await flush();
        expect(s.h.service.getActiveTasks()).toStrictEqual([]);
        expect(s.events).toStrictEqual([
            "start:demo/long",
            "pstart:demo/long:100",
            "pend:demo/long:undefined",
            "end:demo/long",
        ]);
        s.dispose();
    });

    it("ProcessExecution и задача без области — процессом, область — папка", async () => {
        const s = setup();
        const task = new Task({ type: "demo", target: "p" }, "p", "demo", new ProcessExecution("node", ["x.js"]));
        await s.owner.runAs(EXT, () => s.tasks.executeTask(task));
        await flush();
        expect(s.h.terminals.getInstances()[0].launch).toMatchObject({ shellPath: "node", shellArgs: ["x.js"] });
        s.dispose();
    });

    it("CustomExecution: колбэк с подставленным определением, pty в терминале задачи, его выход — конец задачи", async () => {
        const s = setup();
        const writes = new EventEmitter<string>();
        const closes = new EventEmitter<number | undefined>();
        const opened = vi.fn();
        const callback = vi.fn((definition: vscode.TaskDefinition) => {
            void definition;
            return Promise.resolve<vscode.Pseudoterminal>({
                onDidWrite: writes.event,
                onDidClose: closes.event,
                open: opened,
                close: () => undefined,
            });
        });
        s.register({
            provideTasks: () => [
                new Task(
                    { type: "demo", target: "${workspaceFolderBasename}" },
                    TaskScope.Workspace,
                    "pty",
                    "demo",
                    new CustomExecution(callback),
                ),
            ],
        });
        await flush();
        const [task] = await s.h.service.tasks({ type: "demo" });
        void s.h.service.run(task);
        await flush();
        expect(callback).toHaveBeenCalledWith({ type: "demo", target: "ws" });
        expect(opened).toHaveBeenCalledWith({ columns: 80, rows: 24 });
        writes.fire("hello from pty");
        await new Promise((r) => setTimeout(r, 20));
        await flush();
        expect(s.ptySessions[0].fed).toStrictEqual(["hello from pty"]);
        closes.fire(0);
        await flush();
        expect(s.events).toStrictEqual(["start:demo/pty", "pstart:demo/pty:-1", "pend:demo/pty:0", "end:demo/pty"]);
        // Повторный запуск — тот же терминал, новый pty.
        void s.h.service.run(task);
        await flush();
        expect(callback).toHaveBeenCalledTimes(2);
        expect(s.ptySessions).toHaveLength(1);
        expect(opened).toHaveBeenCalledTimes(2);
        s.dispose();
    });

    it("отказы: задача без исполнения, неизвестный id; запуск, не дошедший до старта, кончается у расширения", async () => {
        const s = setup();
        await expect(
            s.tasks.executeTask(new Task({ type: "demo", target: "x" }, TaskScope.Workspace, "x", "demo")),
        ).rejects.toThrow("Tasks to execute must include an execution");
        const ghost = new Task(
            { type: "demo", target: "g" },
            TaskScope.Workspace,
            "g",
            "demo",
            new ShellExecution("x"),
        );
        ghost.handleId = "nope";
        await expect(s.tasks.executeTask(ghost)).rejects.toThrow("Task not found");
        expect(s.tasks.taskExecutions).toStrictEqual([]);
        const bad = s.shellTask("bad", "echo ${input:x}");
        await s.owner.runAs(EXT, () => s.tasks.executeTask(bad));
        await flush();
        expect(s.events).toStrictEqual(["end:demo/bad"]);
        expect(s.tasks.taskExecutions).toStrictEqual([]);
        s.dispose();
    });

    it("смерть субпроцесса снимает его провайдеров", async () => {
        const s = setup();
        s.register({ provideTasks: () => [s.shellTask("a", "echo a")] });
        await flush();
        expect(await s.h.service.tasks({ type: "demo" })).toHaveLength(1);
        s.dispose();
        expect(await s.h.service.tasks({ type: "demo" })).toStrictEqual([]);
    });
});

describe("TasksCustomer без стока", () => {
    it("fetchTasks пуст, executeTask отклоняется", async () => {
        const [a, b] = createInProcessChannelPair();
        const hostRpc = new RpcEndpoint(a) as unknown as HostRpc;
        const subRpc = new RpcEndpoint(b) as unknown as SubprocessRpc;
        const attached = new TasksCustomer(undefined).attach({ rpc: hostRpc, logger: undefined });
        const tasks = createTasksNamespace({
            rpc: subRpc,
            owner: new ExtensionOwner(),
            workspaceFolders: () => undefined,
            attachPty: () => undefined,
            onDidReceiveCatalog: new EventEmitter<readonly IWireExtensionDescription[]>().event,
        });
        await expect(tasks.fetchTasks()).resolves.toStrictEqual([]);
        await expect(
            tasks.executeTask(new Task({ type: "shell" }, TaskScope.Workspace, "x", "s", new ShellExecution("x"))),
        ).rejects.toThrow("Tasks are not supported in this host.");
        attached.dispose();
    });
});

describe("TasksCustomer — провод без субпроцесса", () => {
    function wire(sink: IExtensionTaskSink | undefined) {
        const [a, b] = createInProcessChannelPair();
        const logger = createLoggerSpy();
        const hostRpc = new RpcEndpoint(a, logger) as unknown as HostRpc;
        const subRpc = new RpcEndpoint(b) as unknown as SubprocessRpc;
        const attached = new TasksCustomer(sink).attach({ rpc: hostRpc, logger: undefined });
        const raw = subRpc as unknown as {
            request(method: string, params: unknown): Promise<unknown>;
            notify(method: string, params: unknown): void;
        };
        return { logger, raw, attached };
    }

    function fakeSink() {
        const registrations: { dispose: ReturnType<typeof vi.fn> }[] = [];
        const sink = {
            subscribe: vi.fn(() => ({ dispose: () => undefined })),
            registerProvider: vi.fn(() => {
                const registration = { dispose: vi.fn() };
                registrations.push(registration);
                return registration;
            }),
            fetch: vi.fn(() => Promise.resolve([])),
            execute: vi.fn(() => Promise.reject(new Error("unexpected"))),
            terminate: vi.fn(),
        };
        return { sink, registrations };
    }

    it("без стока tasks.fetch отвечает пустым списком", async () => {
        const { raw, attached } = wire(undefined);
        await expect(raw.request("tasks.fetch", {})).resolves.toStrictEqual([]);
        attached.dispose();
    });

    it("снятие провайдера: его регистрация снимается один раз; чужой и битый handle — без ошибок", async () => {
        const { sink, registrations } = fakeSink();
        const { logger, raw, attached } = wire(sink as unknown as IExtensionTaskSink);
        raw.notify("tasks.registerProvider", { handle: 1, type: "demo", extensionId: "e" });
        raw.notify("tasks.registerProvider", { handle: "x" });
        raw.notify("tasks.unregisterProvider", { handle: 1 });
        raw.notify("tasks.unregisterProvider", { handle: 1 });
        raw.notify("tasks.unregisterProvider", { handle: 9 });
        raw.notify("tasks.unregisterProvider", null);
        await flush();
        expect(sink.registerProvider).toHaveBeenCalledTimes(1);
        expect(registrations[0].dispose).toHaveBeenCalledTimes(1);
        expect(logger.warn).not.toHaveBeenCalled();
        attached.dispose();
    });

    it("битые execute и terminate до стока не доходят", async () => {
        const { sink } = fakeSink();
        const { logger, raw, attached } = wire(sink as unknown as IExtensionTaskSink);
        await expect(raw.request("tasks.execute", { task: { name: 1 } })).rejects.toThrow("Task is not valid");
        raw.notify("tasks.terminate", { id: 1 });
        raw.notify("tasks.terminate", { id: "t" });
        await flush();
        expect(sink.execute).not.toHaveBeenCalled();
        expect(sink.terminate.mock.calls).toStrictEqual([["t"]]);
        expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining("tasks.terminate"), expect.anything());
        attached.dispose();
    });
});
