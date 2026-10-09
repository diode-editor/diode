import { describe, expect, it, vi } from "vitest";

import { makeTask } from "../../../../../TestUtils/taskFixtures.ts";
import { buildTaskServiceHarness } from "../../../../../TestUtils/taskServiceHarness.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { IWorkspaceContextService } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import type { IExtensionTaskEvents } from "../../../api/common/iExtensionTaskSink.ts";
import type { IWireTask } from "../../../api/common/taskWireTypes.ts";
import type { IExtensionService } from "../../../services/extensions/common/extensions.ts";

import { bindExtensionTasks, ExtensionTaskAdapter, RUN_TASK_ACTIVATION_EVENT } from "./extensionTaskAdapter.ts";

// Мост задач в одиночку: края, которые сквозной тест провода не видит
// (`services/extensions/node/customers/tasksCustomer.test.ts`).

const workspace = { getWorkspace: () => ({ id: "ws", folders: [] }) } as unknown as IWorkspaceContextService;

function setup() {
    const h = buildTaskServiceHarness();
    const adapter = new ExtensionTaskAdapter(h.service, workspace, h.logger);
    const events = {
        started: vi.fn<IExtensionTaskEvents["started"]>(),
        processStarted: vi.fn<IExtensionTaskEvents["processStarted"]>(),
        processEnded: vi.fn<IExtensionTaskEvents["processEnded"]>(),
        ended: vi.fn<IExtensionTaskEvents["ended"]>(),
    };
    return { h, adapter, events };
}

describe("ExtensionTaskAdapter", () => {
    it("задача провайдера без исполнения выпадает с предупреждением в лог `tasks`", async () => {
        const { h, adapter } = setup();
        adapter.registerProvider("pub.ext", "demo", () =>
            Promise.resolve([
                {
                    name: "x",
                    execution: undefined,
                    definition: { type: "demo" },
                    isBackground: false,
                    source: { label: "demo", extensionId: "pub.ext", scope: 2 },
                    problemMatchers: [],
                    hasDefinedMatchers: false,
                },
            ]),
        );
        expect(await h.service.tasks({ type: "demo" })).toStrictEqual([]);
        expect(h.logger.warn).toHaveBeenCalledWith('Task System: a task of "pub.ext" has no execution and is dropped.');
        h.dispose();
    });

    it("описание без исполнения в execute — «Task is not valid»", async () => {
        const { h, adapter } = setup();
        await expect(
            adapter.execute({
                task: {
                    name: "x",
                    execution: undefined,
                    definition: { type: "demo" },
                    isBackground: false,
                    source: { label: "demo", extensionId: "e", scope: 2 },
                    problemMatchers: [],
                    hasDefinedMatchers: false,
                },
            }),
        ).rejects.toThrow("Task is not valid");
        h.dispose();
    });

    it("подписка: события ядра; после отписки — тишина; terminate чужого id — ничего", async () => {
        const { h, adapter, events } = setup();
        const subscription = adapter.subscribe(events);
        void h.service.run(makeTask({ label: "a" }));
        await vi.waitFor(() => {
            expect(events.started).toHaveBeenCalledTimes(1);
        });
        expect(events.started.mock.calls[0][0].id).toBe("$core.a");
        expect(events.processStarted).toHaveBeenCalledWith("$core.a", 100);
        adapter.terminate("nope");
        expect(h.service.getActiveTasks()).toHaveLength(1);
        adapter.terminate("$core.a");
        await vi.waitFor(() => {
            expect(events.ended).toHaveBeenCalledTimes(1);
        });
        expect(events.processEnded).toHaveBeenCalledWith("$core.a", undefined);
        subscription.dispose();
        void h.service.run(makeTask({ label: "b" }));
        await vi.waitFor(() => {
            expect(h.service.getActiveTasks()).toHaveLength(1);
        });
        expect(events.started).toHaveBeenCalledTimes(1);
        h.dispose();
    });

    it("отписка прежнего подписчика не глушит нового; конец не стартовавшей задачи — новому", async () => {
        const { h, adapter, events } = setup();
        const first = adapter.subscribe(events);
        const second = { ...events, ended: vi.fn<IExtensionTaskEvents["ended"]>() };
        adapter.subscribe(second);
        first.dispose();
        await adapter.execute({
            task: {
                name: "bad",
                execution: { commandLine: "echo ${input:x}" },
                definition: { type: "demo" },
                isBackground: false,
                source: { label: "demo", extensionId: "e", scope: 2 },
                problemMatchers: [],
                hasDefinedMatchers: false,
            },
        });
        await vi.waitFor(() => {
            expect(second.ended).toHaveBeenCalledTimes(1);
        });
        h.dispose();
    });

    it("запуск, упавший после старта, лишнего конца не шлёт", async () => {
        const { h, adapter, events } = setup();
        adapter.subscribe(events);
        // Тот же id уже бежит: повторный запуск отказа не даёт, но и не стартует — конца нет.
        void h.service.run(makeTask({ label: "a", runOptions: { instancePolicy: "silent" } }));
        await vi.waitFor(() => {
            expect(events.started).toHaveBeenCalledTimes(1);
        });
        await adapter.execute({ id: "$core.a" }).catch(() => undefined);
        expect(events.ended).not.toHaveBeenCalled();
        h.dispose();
    });
});

describe("ExtensionTaskAdapter — края", () => {
    const wire = (overrides: Partial<IWireTask> = {}): IWireTask => ({
        name: "x",
        execution: { commandLine: "echo x" },
        definition: { type: "demo" },
        isBackground: false,
        source: { label: "demo", extensionId: "e", scope: 2 },
        problemMatchers: [],
        hasDefinedMatchers: false,
        ...overrides,
    });

    it("годные задачи провайдера проходят без предупреждений, без исполнения — выпадают по одной", async () => {
        const { h, adapter } = setup();
        adapter.registerProvider("pub.ext", "demo", () =>
            Promise.resolve([wire({ name: "ok" }), wire({ name: "bad", execution: undefined })]),
        );
        expect((await h.service.tasks({ type: "demo" })).map((task) => task.name)).toStrictEqual(["ok"]);
        expect(h.logger.warn).toHaveBeenCalledTimes(1);
        h.dispose();
    });

    it("fetch: с типом — только задачи типа, без типа — все", async () => {
        const { h, adapter } = setup();
        adapter.registerProvider("pub.ext", "demo", () => Promise.resolve([wire({ name: "d" })]));
        adapter.registerProvider("pub.ext", "other", () =>
            Promise.resolve([wire({ name: "o", definition: { type: "other" } })]),
        );
        expect((await adapter.fetch("other")).map((task) => task.name)).toStrictEqual(["o"]);
        expect((await adapter.fetch(undefined)).map((task) => task.name).sort()).toStrictEqual(["d", "o"]);
        h.dispose();
    });

    it("отписавшийся подписчик конца не получает, и без подписчика отказ запуска тихий", async () => {
        const { h, adapter, events } = setup();
        const unhandled = vi.fn();
        process.on("unhandledRejection", unhandled);
        try {
            adapter.subscribe(events).dispose();
            await adapter.execute({ task: wire({ execution: { commandLine: "echo ${input:x}" } }) });
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
            expect(events.ended).not.toHaveBeenCalled();
            expect(unhandled).not.toHaveBeenCalled();
        } finally {
            process.off("unhandledRejection", unhandled);
            h.dispose();
        }
    });

    it("полная жизнь задачи — по одному событию каждого вида", async () => {
        const { h, adapter, events } = setup();
        adapter.subscribe(events);
        void h.service.run(makeTask({ label: "a" }));
        await vi.waitFor(() => {
            expect(events.started).toHaveBeenCalledTimes(1);
        });
        adapter.terminate("$core.a");
        await vi.waitFor(() => {
            expect(events.ended).toHaveBeenCalledTimes(1);
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        expect([
            events.started.mock.calls.length,
            events.processStarted.mock.calls.length,
            events.processEnded.mock.calls.length,
            events.ended.mock.calls.length,
        ]).toStrictEqual([1, 1, 1, 1]);
        h.dispose();
    });

    it("terminate неизвестного id сервис не трогает", () => {
        const { h, adapter } = setup();
        const terminate = vi.spyOn(h.service, "terminate").mockResolvedValue(true);
        adapter.terminate("nope");
        expect(terminate).not.toHaveBeenCalled();
        h.dispose();
    });

    it("определение против схемы типа: несоответствие — предупреждение в лог `tasks`", async () => {
        const { h, adapter } = setup();
        h.service.registerTaskDefinitions([
            {
                extensionId: "e",
                taskType: "demo",
                required: ["target"],
                properties: { target: { type: "object" } },
                when: undefined,
            },
        ]);
        await adapter.execute({ task: wire() });
        expect(h.logger.warn).toHaveBeenCalledWith(expect.stringContaining("missing the required property 'target'"));
        h.dispose();
    });
});

describe("bindExtensionTasks", () => {
    function extensions(activated: string[]): IExtensionService {
        return {
            extensions: [
                {
                    id: "pub.a",
                    manifest: { contributes: { taskDefinitions: [{ type: "npm" }, { required: [] }] } },
                } as unknown as IExtension,
                {
                    id: "pub.b",
                    manifest: { contributes: { taskDefinitions: [{ type: "gulp", when: "taskRunning" }] } },
                } as unknown as IExtension,
                { id: "pub.c", manifest: {} } as unknown as IExtension,
            ],
            whenInstalledExtensionsRegistered: () => Promise.resolve(),
            activateByEvent: (event: string) => {
                activated.push(event);
                return Promise.resolve();
            },
        } as unknown as IExtensionService;
    }

    it("типы всех расширений; активация без типа — runTask и onTaskType всех типов, с типом — только его", async () => {
        const { h } = setup();
        const activated: string[] = [];
        const binding = bindExtensionTasks(h.service, extensions(activated), { createPtyInstance: () => 1 }, h.logger);
        expect(h.service.taskDefinitionTypes()).toStrictEqual(["npm", "gulp"]);
        expect(h.service.getTaskDefinition("gulp")?.when).toBe("taskRunning");
        expect(h.logger.warn).toHaveBeenCalledWith(
            "pub.a: The task type configuration is missing the required 'taskType' property",
        );
        await h.service.tasks();
        expect(activated).toStrictEqual([RUN_TASK_ACTIVATION_EVENT, "onTaskType:npm", "onTaskType:gulp"]);
        activated.length = 0;
        await h.service.tasks({ type: "gulp" });
        expect(activated).toStrictEqual([RUN_TASK_ACTIVATION_EVENT, "onTaskType:gulp"]);
        // Снятие — активатор и мост pty уходят.
        binding.dispose();
        activated.length = 0;
        await h.service.tasks();
        expect(activated).toStrictEqual([]);
        await expect(
            h.service.run(
                makeTask({ command: { runtime: "custom" }, extension: { type: "x", extensionId: "e", source: "s" } }),
            ),
        ).rejects.toThrow("need the extension host");
        h.dispose();
    });
});
