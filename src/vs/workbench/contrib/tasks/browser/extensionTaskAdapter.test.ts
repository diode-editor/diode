import { describe, expect, it, vi } from "vitest";

import { makeTask } from "../../../../../TestUtils/taskFixtures.ts";
import { buildTaskServiceHarness } from "../../../../../TestUtils/taskServiceHarness.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { IWorkspaceContextService } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import type { IExtensionTaskEvents } from "../../../api/common/iExtensionTaskSink.ts";
import type { IWireTask } from "../../../api/common/taskWireTypes.ts";
import type { IExtensionService } from "../../../services/extensions/common/extensions.ts";

import { bindExtensionTasks, ExtensionTaskAdapter, RUN_TASK_ACTIVATION_EVENT } from "./extensionTaskAdapter.ts";

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
    it("a provider task without execution is dropped with a warning in the `tasks` log", async () => {
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

    it("a description without execution in execute — 'Task is not valid'", async () => {
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

    it("subscription: core events; after unsubscribing — silence; terminate of an unknown id — nothing", async () => {
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

    it("unsubscribing the previous subscriber does not silence the new one; the end of a task that never started goes to the new one", async () => {
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

    it("a run that fails after start sends no extra end", async () => {
        const { h, adapter, events } = setup();
        adapter.subscribe(events);
        // The same id is already running: the rerun is not refused but does not start either, so no end event is sent.
        void h.service.run(makeTask({ label: "a", runOptions: { instancePolicy: "silent" } }));
        await vi.waitFor(() => {
            expect(events.started).toHaveBeenCalledTimes(1);
        });
        await adapter.execute({ id: "$core.a" }).catch(() => undefined);
        expect(events.ended).not.toHaveBeenCalled();
        h.dispose();
    });
});

describe("ExtensionTaskAdapter — edge cases", () => {
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

    it("valid provider tasks pass without warnings, ones without execution are dropped one by one", async () => {
        const { h, adapter } = setup();
        adapter.registerProvider("pub.ext", "demo", () =>
            Promise.resolve([wire({ name: "ok" }), wire({ name: "bad", execution: undefined })]),
        );
        expect((await h.service.tasks({ type: "demo" })).map((task) => task.name)).toStrictEqual(["ok"]);
        expect(h.logger.warn).toHaveBeenCalledTimes(1);
        h.dispose();
    });

    it("fetch: with a type — only tasks of the type, without a type — all", async () => {
        const { h, adapter } = setup();
        adapter.registerProvider("pub.ext", "demo", () => Promise.resolve([wire({ name: "d" })]));
        adapter.registerProvider("pub.ext", "other", () =>
            Promise.resolve([wire({ name: "o", definition: { type: "other" } })]),
        );
        expect((await adapter.fetch("other")).map((task) => task.name)).toStrictEqual(["o"]);
        expect((await adapter.fetch(undefined)).map((task) => task.name).sort()).toStrictEqual(["d", "o"]);
        h.dispose();
    });

    it("an unsubscribed subscriber gets no end, and without a subscriber a run refusal is silent", async () => {
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

    it("full task lifecycle — one event of each kind", async () => {
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

    it("terminate of an unknown id does not touch the service", () => {
        const { h, adapter } = setup();
        const terminate = vi.spyOn(h.service, "terminate").mockResolvedValue(true);
        adapter.terminate("nope");
        expect(terminate).not.toHaveBeenCalled();
        h.dispose();
    });

    it("definition against the type schema: a mismatch is a warning in the `tasks` log", async () => {
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

    it("types of all extensions; activation without a type — runTask and onTaskType of all types, with a type — only its own", async () => {
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

    it("manifests' matchers are registered without activation; a broken one goes to the `tasks` log", async () => {
        const h = buildTaskServiceHarness({
            matcherExtensions: null,
            tasksJson: JSON.stringify({
                version: "2.0.0",
                tasks: [{ label: "t", type: "shell", command: "x", problemMatcher: { base: "$m", owner: "o" } }],
            }),
        });
        const activated: string[] = [];
        const service = {
            extensions: [
                {
                    id: "pub.m",
                    manifest: {
                        contributes: {
                            problemPatterns: [{ name: "broken", regexp: "(" }],
                            problemMatchers: [{ name: "m", owner: "pub", source: "pub-src", pattern: "$go" }],
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
        bindExtensionTasks(h.service, service, { createPtyInstance: () => 1 }, h.logger);
        const [task] = await h.service.getWorkspaceTasks();
        expect(task.problemMatchers).toMatchObject([{ owner: "o", source: "pub-src" }]);
        expect(h.logger.warn).toHaveBeenCalledWith("pub.m: Invalid problem pattern. The pattern will be ignored.");
        expect(activated).toStrictEqual([]);
        h.dispose();
    });
});
