import { describe, expect, it } from "vitest";

import { makeTask } from "../../../../../TestUtils/taskFixtures.ts";
import { buildTaskServiceHarness, tasksJsonOf } from "../../../../../TestUtils/taskServiceHarness.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { ServiceAccessor, Token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ITaskDefinitionSchema } from "../../../api/common/taskIdentity.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";

import { runTaskAction } from "./taskActions.ts";
import { TaskServiceDIToken } from "./taskService.ts";

const npmDefinition: ITaskDefinitionSchema = {
    extensionId: "pub.ext",
    taskType: "npm",
    required: ["script"],
    properties: { script: { type: "string" } },
    when: undefined,
};

function build(options: Parameters<typeof buildTaskServiceHarness>[0] = {}) {
    const h = buildTaskServiceHarness(options);
    h.service.registerTaskDefinitions([npmDefinition]);
    let provided = 0;
    const npm = (script: string) =>
        makeTask({
            label: script,
            extension: { type: "npm", extensionId: "pub.ext", source: "npm" },
            definition: { script },
            command: { name: `npm run ${script}` },
        });
    const withNpm = (scripts: string[]): void => {
        h.service.registerTaskProvider(
            {
                provideTasks: () => {
                    provided++;
                    return Promise.resolve(scripts.map(npm));
                },
            },
            "npm",
        );
    };
    const services = new Map<Token<unknown>, unknown>([
        [TaskServiceDIToken, h.service],
        [QuickInputServiceDIToken, h.quickInput],
        [IConfigurationServiceDIToken, h.configuration],
    ]);
    const accessor = { get: (token: Token<unknown>) => services.get(token) } as unknown as ServiceAccessor;
    const launched = (): string[] => h.terminals.getInstances().map((i) => i.title);
    return { ...h, withNpm, accessor, launched, providedCount: () => provided };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("TaskService — provider task customizations", () => {
    it("groupedTasks/tasks: a provider task comes merged with its entry; the rest stay as they were", async () => {
        const h = build({ tasksJson: tasksJsonOf([{ type: "npm", script: "lint", label: "Lint!" }]) });
        h.withNpm(["lint", "build"]);
        const grouped = await h.service.groupedTasks();
        expect(grouped.map((t) => [t._label, t.configIndex])).toStrictEqual([
            ["Lint!", 0],
            ["npm: build", undefined],
        ]);
        expect((await h.service.tasks({ type: "npm" })).map((t) => t._label)).toStrictEqual(["Lint!", "npm: build"]);
        expect(h.logger.warn).not.toHaveBeenCalled();
        h.dispose();
    });

    it("matching is by definition key, not by task id (the extension sets the `CustomExecution` id)", async () => {
        const h = build({ tasksJson: tasksJsonOf([{ type: "npm", script: "lint", label: "L" }]) });
        const custom = {
            ...makeTask({
                label: "lint",
                extension: { type: "npm", extensionId: "pub.ext", source: "npm" },
                definition: { script: "lint" },
            }),
            _id: "ext-own-id",
        };
        h.service.registerTaskProvider({ provideTasks: () => Promise.resolve([custom]) }, "npm");
        expect((await h.service.groupedTasks()).map((t) => [t._id, t._label])).toStrictEqual([["ext-own-id", "L"]]);
        h.dispose();
    });

    it("an entry the provider gave no task for — upstream error logged once; with another type filter — silent", async () => {
        const h = build({ tasksJson: tasksJsonOf([{ type: "npm", script: "gone" }]) });
        h.withNpm(["lint"]);
        await h.service.groupedTasks("gulp");
        expect(h.logger.warn).not.toHaveBeenCalled();
        await h.service.groupedTasks("npm");
        expect(h.logger.warn).toHaveBeenCalledTimes(1);
        await h.service.groupedTasks();
        expect(h.logger.warn).toHaveBeenCalledTimes(1);
        expect(h.logger.warn.mock.calls[0][0]).toBe(
            'Error: The npm task detection didn\'t contribute a task for the following configuration:\n{\n    "type": "npm",\n    "script": "gone"\n}\nThe task will be ignored.',
        );
        h.dispose();
    });

    it("two entries without a task — a message for each", async () => {
        const h = build({
            tasksJson: tasksJsonOf([
                { type: "npm", script: "x" },
                { type: "npm", script: "y" },
            ]),
        });
        h.withNpm(["lint"]);
        await h.service.groupedTasks();
        expect(h.logger.warn).toHaveBeenCalledTimes(2);
        h.dispose();
    });

    it("providers disabled (`task.autoDetect: off`) — an 'unavailable' warning, not an error", async () => {
        const h = build({
            tasksJson: tasksJsonOf([{ type: "npm", script: "lint" }]),
            settings: { "task.autoDetect": "off" },
        });
        h.withNpm(["lint"]);
        await h.service.groupedTasks();
        expect(h.logger.warn.mock.calls).toStrictEqual([
            ["Warning: npm tasks are unavailable in the current environment."],
        ]);
        h.dispose();
    });

    it("provider type registered after the read — the file problems are reported again", async () => {
        const h = buildTaskServiceHarness({ tasksJson: tasksJsonOf([{ type: "npm", script: "lint" }]) });
        await h.service.getWorkspaceConfiguration();
        expect(h.logger.warn.mock.calls[0][0]).toMatch(/^Error: there is no registered task type 'npm'\./u);
        h.service.registerTaskDefinitions([npmDefinition]);
        const { configuring } = await h.service.getWorkspaceConfiguration();
        expect(configuring.map((c) => c._label)).toStrictEqual(["npm: lint"]);
        await h.service.getWorkspaceConfiguration();
        expect(h.logger.warn).toHaveBeenCalledTimes(1);
        h.dispose();
    });

    it("resolveConfiguringTask — the merged task of that entry; the provider gave none — undefined", async () => {
        const h = build({
            tasksJson: tasksJsonOf([
                { label: "own", command: "x" },
                { type: "npm", script: "lint", label: "A" },
                { type: "npm", script: "gone", label: "B" },
            ]),
        });
        h.withNpm(["lint"]);
        const [a, b] = (await h.service.getWorkspaceConfiguration()).configuring;
        expect((await h.service.resolveConfiguringTask(a))?._label).toBe("A");
        await expect(h.service.resolveConfiguringTask(b)).resolves.toBeUndefined();
        h.dispose();
    });

    it("tasksJsonUri — tasks.json of the first folder; without a folder — undefined", () => {
        const h = build();
        expect(h.service.tasksJsonUri()?.fsPath).toBe("/ws/.diode/tasks.json");
        h.dispose();
        const none = build({ folder: null });
        expect(none.service.tasksJsonUri()).toBeUndefined();
        none.dispose();
    });
});

describe("Run Task — customizations on the first level", () => {
    it("the entry is in 'configured' among own tasks by label, without querying providers; picking runs the merged task", async () => {
        const h = build({
            tasksJson: tasksJsonOf([
                { label: "zz", command: "x" },
                { type: "npm", script: "lint", label: "Lint", presentation: { echo: false } },
                { type: "npm", script: "build", hide: true },
            ]),
        });
        h.withNpm(["lint", "build"]);
        h.answerPicks("Lint");
        await runTaskAction.run(h.accessor);
        await flush();
        expect(h.picks[0].items.slice(0, 2).map((i) => [i.label, i.hint])).toStrictEqual([
            ["Lint", "configured"],
            ["zz", undefined],
        ]);
        expect(h.launched()).toStrictEqual(["Lint"]);
        expect(h.service.getActiveTasks()[0].command).toMatchObject({
            name: "npm run lint",
            presentation: { echo: false },
        });
        h.dispose();
    });

    it("a single entry and `task.quickOpen.skip` — no picker; the provider gave no task — nothing runs", async () => {
        const h = build({
            tasksJson: tasksJsonOf([{ type: "npm", script: "lint", label: "Lint" }]),
            settings: { "task.quickOpen.skip": true },
        });
        h.withNpm(["lint"]);
        await runTaskAction.run(h.accessor);
        await flush();
        expect(h.picks).toHaveLength(0);
        expect(h.launched()).toStrictEqual(["Lint"]);
        h.dispose();
        const gone = build({
            tasksJson: tasksJsonOf([{ type: "npm", script: "gone" }]),
            settings: { "task.quickOpen.skip": true },
        });
        gone.withNpm(["lint"]);
        await runTaskAction.run(gone.accessor);
        await flush();
        expect(gone.launched()).toStrictEqual([]);
        gone.dispose();
    });

    it("the first level does not query providers — only picking an entry does", async () => {
        const h = build({ tasksJson: tasksJsonOf([{ type: "npm", script: "lint", label: "Lint" }]) });
        h.withNpm(["lint"]);
        h.answerPicks(undefined);
        await runTaskAction.run(h.accessor);
        expect(h.providedCount()).toBe(0);
        h.dispose();
    });
});
