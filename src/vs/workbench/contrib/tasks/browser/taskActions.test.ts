import { describe, expect, it, vi } from "vitest";

import { makeTask } from "../../../../../TestUtils/taskFixtures.ts";
import { buildTaskServiceHarness, tasksJsonOf } from "../../../../../TestUtils/taskServiceHarness.ts";
import { CODICON_GLYPHS } from "../../../../base/common/codicons.generated.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { ServiceAccessor, Token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ITaskDefinitionSchema } from "../../../api/common/taskIdentity.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";

import {
    reRunTaskAction,
    restartTaskAction,
    runTaskAction,
    showTasksAction,
    TASKS_ACTIONS,
    terminateTaskAction,
} from "./taskActions.ts";
import { GO_BACK, SHOW_ALL_TASKS } from "./taskQuickPick.ts";
import { TaskServiceDIToken } from "./taskService.ts";

// Команды задач поверх сервиса: аргументы, пикеры (двухуровневый Run Task),
// Terminate со строкой «All Running Tasks», Restart, Show Running Tasks.

const definition = (taskType: string): ITaskDefinitionSchema => ({
    extensionId: "pub.ext",
    taskType,
    required: [],
    properties: { script: { type: "string" } },
    when: undefined,
});

function build(options: Parameters<typeof buildTaskServiceHarness>[0] = {}) {
    const h = buildTaskServiceHarness(options);
    const services = new Map<Token<unknown>, unknown>([
        [TaskServiceDIToken, h.service],
        [QuickInputServiceDIToken, h.quickInput],
        [IConfigurationServiceDIToken, h.configuration],
    ]);
    const accessor = { get: (token: Token<unknown>) => services.get(token) } as unknown as ServiceAccessor;
    const npm = (label: string, extra: Record<string, unknown> = {}) =>
        makeTask({
            label,
            extension: { type: "npm", extensionId: "pub.ext", source: "npm" },
            definition: { script: label, ...extra },
            command: { name: `echo ${label}` },
        });
    const withNpm = (labels: string[]): void => {
        h.service.registerTaskDefinitions([definition("npm")]);
        h.service.registerTaskProvider({ provideTasks: () => Promise.resolve(labels.map((l) => npm(l))) }, "npm");
    };
    /** Строка, под которой задача уходит в терминал — по ней видно, что запустилось. */
    const launched = (): string[] => h.terminals.getInstances().map((i) => i.title);
    return { ...h, accessor, withNpm, launched };
}

/** Запуск идёт в фоне за сохранением редакторов — дождаться его. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const folderLabel = (type: string): string => `${CODICON_GLYPHS.folder ?? ""} ${type}`;

describe("Run Task — двухуровневый пикер", () => {
    it("первый уровень: configured (подсказка у первой), типы (contributed) и «Show All Tasks...»", async () => {
        const h = build({
            tasksJson: tasksJsonOf([
                { label: "b", command: "x" },
                { label: "a", command: "x" },
                { label: "h", command: "x", hide: true },
            ]),
        });
        h.withNpm(["lint"]);
        h.answerPicks(undefined);
        await runTaskAction.run(h.accessor);
        await flush();
        expect(h.picks[0].placeholder).toBe("Select the task to run");
        expect(h.picks[0].items.map((i) => [i.label, i.hint])).toStrictEqual([
            ["a", "configured"],
            ["b", undefined],
            [folderLabel("npm"), "contributed"],
            [SHOW_ALL_TASKS, undefined],
        ]);
        expect(h.launched()).toStrictEqual([]);
        h.dispose();
    });

    it("задача первого уровня запускается", async () => {
        const h = build({ tasksJson: tasksJsonOf([{ label: "a", command: "x" }]) });
        h.answerPicks("a");
        await runTaskAction.run(h.accessor);
        await flush();
        expect(h.launched()).toStrictEqual(["a"]);
        h.dispose();
    });

    it("тип → задачи типа и «Go back ↩»; назад — снова первый уровень; там — задача", async () => {
        const h = build({ tasksJson: tasksJsonOf([{ label: "a", command: "x" }]) });
        h.withNpm(["test", "build"]);
        h.answerPicks(folderLabel("npm"), GO_BACK, folderLabel("npm"), "npm: test");
        await runTaskAction.run(h.accessor);
        await flush();
        expect(h.picks.map((p) => p.items.map((i) => i.label))).toStrictEqual([
            ["a", folderLabel("npm"), SHOW_ALL_TASKS],
            ["npm: build", "npm: test", GO_BACK],
            ["a", folderLabel("npm"), SHOW_ALL_TASKS],
            ["npm: build", "npm: test", GO_BACK],
        ]);
        expect(h.launched()).toStrictEqual(["test"]);
        h.dispose();
    });

    it("тип без задач — «No npm tasks found. Go back ↩»; Show All — все задачи", async () => {
        const h = build({ tasksJson: tasksJsonOf([{ label: "a", command: "x" }]) });
        h.withNpm([]);
        h.service.registerTaskProvider(
            {
                provideTasks: () =>
                    Promise.resolve([
                        makeTask({ label: "g", extension: { type: "gulp", extensionId: "e", source: "gulp" } }),
                    ]),
            },
            "gulp",
        );
        h.answerPicks(folderLabel("npm"), `No npm tasks found. ${GO_BACK}`, SHOW_ALL_TASKS, "gulp: g");
        await runTaskAction.run(h.accessor);
        await flush();
        expect(h.picks[1].items.map((i) => i.label)).toStrictEqual([`No npm tasks found. ${GO_BACK}`]);
        expect(h.picks[3].items.map((i) => i.label)).toStrictEqual(["a", "gulp: g"]);
        expect(h.launched()).toStrictEqual(["g"]);
        h.dispose();
    });

    it("отмена на втором уровне — ничего; ни задач, ни типов — строка «No tasks found»", async () => {
        const h = build();
        h.answerPicks("No tasks found");
        await runTaskAction.run(h.accessor);
        await flush();
        expect(h.lastPickLabels()).toStrictEqual(["No tasks found"]);
        expect(h.picks).toHaveLength(1);
        expect(h.launched()).toStrictEqual([]);
        h.withNpm(["x"]);
        h.answerPicks(folderLabel("npm"), undefined);
        await runTaskAction.run(h.accessor);
        await flush();
        expect(h.launched()).toStrictEqual([]);
        // Отмена — не отказ запуска: сообщений нет.
        expect(h.notifications.passive()).toStrictEqual([]);
        h.dispose();
    });

    it("task.quickOpen.skip и одна задача tasks.json — без пикера", async () => {
        const h = build({
            settings: { "task.quickOpen.skip": true },
            tasksJson: tasksJsonOf([{ label: "only", command: "x" }]),
        });
        await runTaskAction.run(h.accessor);
        await flush();
        expect(h.picks).toStrictEqual([]);
        expect(h.launched()).toStrictEqual(["only"]);
        h.dispose();
    });

    it("без task.quickOpen.skip одна задача — всё равно пикер; со skip, но двумя — тоже", async () => {
        const one = build({ tasksJson: tasksJsonOf([{ label: "only", command: "x" }]) });
        one.answerPicks(undefined);
        await runTaskAction.run(one.accessor);
        expect(one.picks).toHaveLength(1);
        one.dispose();
        const two = build({
            settings: { "task.quickOpen.skip": true },
            tasksJson: tasksJsonOf([
                { label: "a", command: "x" },
                { label: "b", command: "x" },
            ]),
        });
        two.answerPicks(undefined);
        await runTaskAction.run(two.accessor);
        expect(two.picks).toHaveLength(1);
        two.dispose();
    });

    it("скрытые задачи (hide) — ни на одном уровне; назад со второго уровня — configured по порядку", async () => {
        const h = build({
            tasksJson: tasksJsonOf([
                { label: "b", command: "x" },
                { label: "hidden", command: "x", hide: true },
                { label: "a", command: "x" },
            ]),
        });
        h.service.registerTaskDefinitions([definition("npm")]);
        h.service.registerTaskProvider(
            {
                provideTasks: () =>
                    Promise.resolve([
                        makeTask({ label: "lint", extension: { type: "npm", extensionId: "pub.ext", source: "npm" } }),
                        makeTask({
                            label: "secret",
                            hide: true,
                            extension: { type: "npm", extensionId: "pub.ext", source: "npm" },
                        }),
                    ]),
            },
            "npm",
        );
        h.answerPicks(GO_BACK, SHOW_ALL_TASKS, undefined);
        await runTaskAction.run(h.accessor, { type: "npm", script: "nope" });
        expect(h.picks.map((p) => p.items.map((i) => i.label))).toStrictEqual([
            ["npm: lint", GO_BACK],
            ["a", "b", folderLabel("npm"), SHOW_ALL_TASKS],
            ["a", "b", "npm: lint"],
        ]);
        h.dispose();
    });

    it("аргумент-подпись — задача сразу; неизвестная — пикер", async () => {
        const h = build({ tasksJson: tasksJsonOf([{ label: "a", command: "x" }]) });
        await runTaskAction.run(h.accessor, "a");
        await flush();
        expect(h.launched()).toStrictEqual(["a"]);
        h.answerPicks(undefined);
        await runTaskAction.run(h.accessor, "zzz");
        await flush();
        expect(h.picks).toHaveLength(1);
        h.dispose();
    });

    it("аргумент-определение — задача провайдера по ключу; не нашлась — сразу второй уровень её типа", async () => {
        const h = build();
        h.withNpm(["lint", "test"]);
        await runTaskAction.run(h.accessor, { type: "npm", script: "test" });
        await flush();
        expect(h.launched()).toStrictEqual(["test"]);
        h.answerPicks(undefined);
        await runTaskAction.run(h.accessor, { type: "npm", script: "nope" });
        await flush();
        expect(h.lastPickLabels()).toStrictEqual(["npm: lint", "npm: test", GO_BACK]);
        h.dispose();
    });

    it("отказ запуска не отклоняет команду", async () => {
        const h = build({ tasksJson: tasksJsonOf([{ label: "bad", command: "${input:x}" }]) });
        await expect(runTaskAction.run(h.accessor, "bad")).resolves.toBeUndefined();
        h.answerPicks("bad");
        await expect(runTaskAction.run(h.accessor)).resolves.toBeUndefined();
        expect(h.notifications.passive()).toHaveLength(2);
        h.dispose();
    });
});

describe("Rerun / Restart / Terminate / Show Running", () => {
    it("Rerun Last Task: нечего — открывает Run Task", async () => {
        const h = build({ tasksJson: tasksJsonOf([{ label: "a", command: "x" }]) });
        h.answerPicks("a");
        await reRunTaskAction.run(h.accessor);
        await flush();
        expect(h.launched()).toStrictEqual(["a"]);
        h.sessions[0].emitExit(0);
        await reRunTaskAction.run(h.accessor);
        await flush();
        expect(h.sessions[0].relaunches).toHaveLength(1);
        expect(h.picks).toHaveLength(1);
        h.dispose();
    });

    it("Restart: одна бегущая — она без вопроса", async () => {
        const h = build({ tasksJson: tasksJsonOf([{ label: "a", type: "shell", command: "x" }]) });
        await runTaskAction.run(h.accessor, "a");
        await flush();
        await restartTaskAction.run(h.accessor);
        await vi.waitFor(() => {
            expect(h.sessions).toHaveLength(2);
        });
        expect(h.picks).toStrictEqual([]);
        h.dispose();
    });

    it("Restart: несколько — по аргументу или пикером «Select the task to restart»; пусто — «No task to restart»", async () => {
        const h = build({
            tasksJson: tasksJsonOf([
                { label: "a", command: "x" },
                { label: "b", command: "y" },
            ]),
        });
        h.answerPicks(undefined);
        await restartTaskAction.run(h.accessor);
        expect(h.lastPickLabels()).toStrictEqual(["No task to restart"]);
        await runTaskAction.run(h.accessor, "a");
        await flush();
        await runTaskAction.run(h.accessor, "b");
        await flush();
        await restartTaskAction.run(h.accessor, "b");
        await vi.waitFor(() => {
            expect(h.sessions).toHaveLength(3);
        });
        h.answerPicks("a");
        await restartTaskAction.run(h.accessor, "zzz");
        expect(h.picks.at(-1)?.placeholder).toBe("Select the task to restart");
        await vi.waitFor(() => {
            expect(h.sessions).toHaveLength(4);
        });
        expect(h.launched()).toStrictEqual(["b", "a"]);
        h.answerPicks(undefined);
        await restartTaskAction.run(h.accessor);
        expect(h.sessions).toHaveLength(4);
        h.dispose();
    });

    it("Terminate: 'terminateAll' — все; аргумент — подходящая; пикер — «All Running Tasks» при нескольких", async () => {
        const h = build({
            tasksJson: tasksJsonOf([
                { label: "a", command: "x" },
                { label: "b", command: "y" },
                { label: "c", command: "z" },
            ]),
        });
        h.answerPicks(undefined);
        await terminateTaskAction.run(h.accessor);
        expect(h.picks[0].placeholder).toBe("Select a task to terminate");
        expect(h.lastPickLabels()).toStrictEqual(["No task is currently running"]);
        for (const label of ["a", "b", "c"]) await runTaskAction.run(h.accessor, label);
        await flush();
        await terminateTaskAction.run(h.accessor, "b");
        expect(h.service.getActiveTasks().map((t) => t.name)).toStrictEqual(["a", "c"]);
        h.answerPicks("c");
        await terminateTaskAction.run(h.accessor);
        expect(h.lastPickLabels()).toStrictEqual(["a", "c", "All Running Tasks"]);
        expect(h.service.getActiveTasks().map((t) => t.name)).toStrictEqual(["a"]);
        await runTaskAction.run(h.accessor, "b");
        await flush();
        h.answerPicks("All Running Tasks");
        await terminateTaskAction.run(h.accessor);
        expect(h.service.getActiveTasks()).toStrictEqual([]);
        await runTaskAction.run(h.accessor, "a");
        await flush();
        await terminateTaskAction.run(h.accessor, "terminateAll");
        expect(h.service.getActiveTasks()).toStrictEqual([]);
        h.answerPicks(undefined);
        await runTaskAction.run(h.accessor, "a");
        await flush();
        await terminateTaskAction.run(h.accessor);
        expect(h.service.getActiveTasks()).toHaveLength(1);
        h.dispose();
    });

    it("Show Running Tasks — к сервису", async () => {
        const h = build();
        h.answerPicks(undefined);
        await showTasksAction.run(h.accessor);
        expect(h.lastPickLabels()).toStrictEqual(["No task is running"]);
        h.dispose();
    });

    it("заголовки палитры и меню Terminal — как у эталона", () => {
        expect(TASKS_ACTIONS.map((a) => [a.id, a.title])).toStrictEqual([
            ["workbench.action.tasks.runTask", "Tasks: Run Task"],
            ["workbench.action.tasks.reRunTask", "Tasks: Rerun Last Task"],
            ["workbench.action.tasks.restartTask", "Tasks: Restart Running Task"],
            ["workbench.action.tasks.terminate", "Tasks: Terminate Task"],
            ["workbench.action.tasks.showTasks", "Tasks: Show Running Tasks"],
        ]);
        expect(
            TASKS_ACTIONS.flatMap((a) => (a.menus ?? []).map((m) => [m.title, m.group, m.order, m.enablement])),
        ).toStrictEqual([
            ["Run Task...", "3_run", 1, undefined],
            ["Restart Running Task...", "5_manage", 2, "taskRunning"],
            ["Terminate Task...", "5_manage", 3, "taskRunning"],
            ["Show Running Tasks...", "5_manage", 1, "taskRunning"],
        ]);
    });
});
