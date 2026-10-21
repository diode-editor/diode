import { describe, expect, it } from "vitest";

import { makeTask } from "../../../../../TestUtils/taskFixtures.ts";
import { buildTaskServiceHarness, tasksJsonOf } from "../../../../../TestUtils/taskServiceHarness.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { type IFileContent, IFileServiceDIToken } from "../../../../platform/files/common/files.ts";
import type { ServiceAccessor, Token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ITaskDefinitionSchema } from "../../../api/common/taskIdentity.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";

import {
    CONFIGURE_TASK_PLACEHOLDER,
    CREATE_TASKS_JSON,
    OPEN_TASKS_JSON,
    TASK_TEMPLATE_PLACEHOLDER,
} from "./configureTask.ts";
import { configureTaskAction, runTaskAction } from "./taskActions.ts";
import { TaskServiceDIToken } from "./taskService.ts";

const npmDefinition: ITaskDefinitionSchema = {
    extensionId: "pub.ext",
    taskType: "npm",
    required: ["script"],
    properties: { script: { type: "string" }, path: { type: "string" } },
    when: undefined,
};

function build(options: Parameters<typeof buildTaskServiceHarness>[0] = {}) {
    const h = buildTaskServiceHarness(options);
    const services = new Map<Token<unknown>, unknown>([
        [TaskServiceDIToken, h.service],
        [QuickInputServiceDIToken, h.quickInput],
        [IConfigurationServiceDIToken, h.configuration],
        [IFileServiceDIToken, h.files],
        [EditorServiceDIToken, h.editors],
        [NotificationServiceDIToken, h.notifications],
    ]);
    const accessor = { get: (token: Token<unknown>) => services.get(token) } as unknown as ServiceAccessor;
    /** Команда задачи — `npm run <скрипт>`. */
    const withNpm = (labels: string[], extra: Parameters<typeof makeTask>[0] = {}): void => {
        h.service.registerTaskDefinitions([npmDefinition]);
        const task = (label: string) =>
            makeTask({
                label,
                extension: { type: "npm", extensionId: "pub.ext", source: "npm" },
                definition: { script: label },
                command: { name: `npm run ${label}` },
                ...extra,
            });
        h.service.registerTaskProvider({ provideTasks: () => Promise.resolve(labels.map(task)) }, "npm");
    };
    const launched = (): string[] => h.terminals.getInstances().map((i) => i.title);
    return { ...h, accessor, withNpm, launched };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("Configure Task — пикер", () => {
    it("нет своих задач и файла: задачи провайдеров и «Create tasks.json file from template»", async () => {
        const h = build();
        h.withNpm(["lint", "build"]);
        h.answerPicks(undefined);
        await configureTaskAction.run(h.accessor);
        expect(h.picks[0].placeholder).toBe(CONFIGURE_TASK_PLACEHOLDER);
        expect(h.lastPickLabels()).toStrictEqual(["npm: build", "npm: lint", CREATE_TASKS_JSON]);
        expect(h.writeFile).not.toHaveBeenCalled();
        h.dispose();
    });

    it("файл есть, но задач в нём нет — «Open tasks.json file»; свои задачи есть — строки файла нет", async () => {
        const empty = build({ tasksJson: tasksJsonOf([]) });
        empty.answerPicks(undefined);
        await configureTaskAction.run(empty.accessor);
        expect(empty.lastPickLabels()).toStrictEqual([OPEN_TASKS_JSON]);
        empty.dispose();
        const h = build({ tasksJson: tasksJsonOf([{ label: "a", command: "x" }]) });
        h.withNpm(["lint"]);
        h.answerPicks(undefined);
        await configureTaskAction.run(h.accessor);
        expect(h.lastPickLabels()).toStrictEqual(["a", "npm: lint"]);
        h.dispose();
    });

    it("одна своя задача и ничего больше — без пикера: файл открыт на её записи", async () => {
        const text = '{\n    "version": "2.0.0",\n    "tasks": [\n        { "label": "a", "command": "x" }\n    ]\n}';
        const h = build({ tasksJson: text });
        await configureTaskAction.run(h.accessor);
        expect(h.picks).toHaveLength(0);
        expect(h.openUri.mock.calls[0][0].fsPath).toBe("/ws/.diode/tasks.json");
        expect(h.opened()?.goToPosition).toHaveBeenCalledWith(3, 8);
        expect(h.opened()?.revealRange).toHaveBeenCalledWith({
            start: { line: 3, character: 8 },
            end: { line: 3, character: 40 },
        });
        expect(h.writeFile).not.toHaveBeenCalled();
        h.dispose();
    });

    it("своя задача из нескольких — файл на её записи; отмена — ничего", async () => {
        const h = build({
            tasksJson: tasksJsonOf([
                { label: "a", command: "x" },
                { label: "b", command: "y" },
            ]),
        });
        h.answerPicks(undefined, "b");
        await configureTaskAction.run(h.accessor);
        expect(h.openUri).not.toHaveBeenCalled();
        await configureTaskAction.run(h.accessor);
        const text = h.tasksJson() ?? "";
        expect(h.opened()?.goToPosition).toHaveBeenCalledWith(0, text.indexOf('{"label":"b"'));
        h.dispose();
    });

    it("без папки — пикер без строки файла, выбор ничего не пишет", async () => {
        const h = build({ folder: null });
        h.withNpm(["lint"]);
        h.answerPicks("npm: lint");
        await configureTaskAction.run(h.accessor);
        expect(h.lastPickLabels()).toStrictEqual(["npm: lint"]);
        expect(h.writeFile).not.toHaveBeenCalled();
        h.dispose();
    });
});

describe("Configure Task — открытие на записи", () => {
    const twoTasks = tasksJsonOf([
        { label: "a", command: "x" },
        { label: "b", command: "y" },
    ]);

    it("файл не открылся — каретку не трогаем ни в чём (ни без редактора, ни в чужом)", async () => {
        const h = build({ tasksJson: twoTasks });
        h.setOpenFails(true);
        h.answerPicks("b");
        await configureTaskAction.run(h.accessor);
        expect(h.opened()).toBeNull();
        h.setOpenFails(false);
        await h.editors.openUri(Uri.file("/ws/other.txt"));
        const other = h.opened();
        h.setOpenFails(true);
        h.answerPicks("b");
        await configureTaskAction.run(h.accessor);
        expect(other?.goToPosition).not.toHaveBeenCalled();
        h.dispose();
    });

    it("файл поменялся между чтениями и записи уже нет — файл открыт, каретка на месте", async () => {
        const h = build({ tasksJson: twoTasks });
        // Первое чтение — список задач сервиса, второе — текст для поиска записи.
        h.readFile.mockImplementationOnce(() =>
            Promise.resolve({ value: new TextEncoder().encode(twoTasks) } as IFileContent),
        );
        h.readFile.mockImplementationOnce(() =>
            Promise.resolve({
                value: new TextEncoder().encode(tasksJsonOf([{ label: "a", command: "x" }])),
            } as IFileContent),
        );
        h.answerPicks("b");
        await configureTaskAction.run(h.accessor);
        expect(h.openUri).toHaveBeenCalledTimes(1);
        expect(h.opened()?.goToPosition).not.toHaveBeenCalled();
        h.dispose();
    });
});

describe("Configure Task — кастомизация задачи провайдера", () => {
    it("файла нет: создаётся tasks.json (каталог — тоже) с записью эталона, файл — на записи", async () => {
        const h = build();
        h.withNpm(["build"], { detail: "tsc -p ." });
        h.answerPicks("npm: build");
        await configureTaskAction.run(h.accessor);
        expect(h.createFolder.mock.calls[0]).toStrictEqual([expect.objectContaining({ fsPath: "/ws/.diode" })]);
        expect(h.tasksJson()).toBe(
            [
                "{",
                "    // See https://go.microsoft.com/fwlink/?LinkId=733558 ",
                "    // for the documentation about the tasks.json format",
                '    "version": "2.0.0",',
                '    "tasks": [',
                "        {",
                '            "type": "npm",',
                '            "script": "build",',
                '            "problemMatcher": [],',
                '            "label": "npm: build",',
                '            "detail": "tsc -p ."',
                "        }",
                "    ]",
                "}",
            ].join("\n"),
        );
        expect(h.opened()?.goToPosition).toHaveBeenCalledWith(5, 8);
        h.dispose();
    });

    it("файл есть: запись дописана в конец tasks, комментарии и форматирование целы", async () => {
        const text = [
            "{",
            "\t// мои задачи",
            '\t"version": "2.0.0",',
            '\t"tasks": [',
            '\t\t{ "label": "a", "command": "x" } // первая',
            "\t]",
            "}",
        ].join("\n");
        const h = build({ tasksJson: text, settings: { "editor.insertSpaces": false } });
        h.withNpm(["lint"]);
        h.answerPicks("npm: lint");
        await configureTaskAction.run(h.accessor);
        // Соседняя запись и её хвостовой комментарий — как были; новая — отдельными строками перед `]`.
        expect(h.tasksJson()).toBe(
            [
                "{",
                "\t// мои задачи",
                '\t"version": "2.0.0",',
                '\t"tasks": [',
                '\t\t{ "label": "a", "command": "x" }, // первая',
                "\t\t{",
                '\t\t\t"type": "npm",',
                '\t\t\t"script": "lint",',
                '\t\t\t"problemMatcher": [],',
                '\t\t\t"label": "npm: lint"',
                "\t\t}",
                "\t]",
                "}",
            ].join("\n"),
        );
        expect(h.opened()?.goToPosition).toHaveBeenCalledWith(5, 2);
        h.dispose();
    });

    it("дописанная запись — задача в Run Task «configured» под своей подписью, запуск — команда провайдера", async () => {
        const h = build({ tasksJson: tasksJsonOf([]) });
        h.withNpm(["lint"]);
        h.answerPicks("npm: lint");
        await configureTaskAction.run(h.accessor);
        h.setTasksJson(
            (h.tasksJson() ?? "").replace(
                '"label": "npm: lint"',
                '"label": "Lint all", "presentation": { "echo": false }',
            ),
        );
        h.answerPicks("Lint all");
        await runTaskAction.run(h.accessor);
        await flush();
        expect(h.picks.at(-1)?.items[0]).toMatchObject({ label: "Lint all", hint: "configured" });
        expect(h.launched()).toStrictEqual(["Lint all"]);
        expect(h.service.getActiveTasks()[0].command).toMatchObject({
            name: "npm run lint",
            presentation: { echo: false },
        });
        h.dispose();
    });

    it("кастомизированную задачу Configure Task открывает на её записи, а не дописывает вторую", async () => {
        const h = build({ tasksJson: tasksJsonOf([{ type: "npm", script: "lint", label: "L" }]) });
        h.withNpm(["lint"]);
        await configureTaskAction.run(h.accessor);
        expect(h.picks).toHaveLength(0);
        expect(h.writeFile).not.toHaveBeenCalled();
        expect(h.opened()?.goToPosition).toHaveBeenCalledWith(0, (h.tasksJson() ?? "").indexOf('{"type"'));
        h.dispose();
    });

    it("битый tasks.json — предупреждение эталона, файл не трогаем", async () => {
        const h = build({ tasksJson: '{ "version": "2.0.0", "tasks": [ ' });
        h.withNpm(["lint"]);
        h.answerPicks("npm: lint");
        await configureTaskAction.run(h.accessor);
        expect(h.writeFile).not.toHaveBeenCalled();
        expect(h.notifications.passive()).toContainEqual(
            expect.objectContaining({
                severity: "warn",
                message:
                    "The current task configuration has errors. Please fix the errors first before customizing a task.",
            }),
        );
        h.dispose();
    });

    it("tasks.json открыт с несохранёнными правками — ошибка эталона; чистый — перечитывается", async () => {
        const dirty = build({ tasksJson: tasksJsonOf([]) });
        dirty.withNpm(["lint"]);
        dirty.openTasksJsonModel(true);
        dirty.answerPicks("npm: lint");
        await configureTaskAction.run(dirty.accessor);
        expect(dirty.writeFile).not.toHaveBeenCalled();
        expect(dirty.openUri).not.toHaveBeenCalled();
        expect(dirty.notifications.passive()).toStrictEqual([
            expect.objectContaining({
                severity: "error",
                message:
                    "Unable to write into tasks configuration file because the file has unsaved changes. Please save it first and then try again.",
            }),
        ]);
        dirty.dispose();
        const clean = build({ tasksJson: tasksJsonOf([]) });
        clean.withNpm(["lint"]);
        const model = clean.openTasksJsonModel(false);
        clean.answerPicks("npm: lint");
        await configureTaskAction.run(clean.accessor);
        expect(clean.writeFile).toHaveBeenCalledTimes(1);
        expect(clean.createFolder).not.toHaveBeenCalled();
        expect(model.revertToDisk).toHaveBeenCalledTimes(1);
        clean.dispose();
    });
});

describe("Configure Task — шаблоны", () => {
    it("Create: пикер шаблонов эталона; выбранный пишется с отступом редактора и открывается", async () => {
        const h = build({ settings: { "editor.tabSize": 2 } });
        h.answerPicks(CREATE_TASKS_JSON, "Others");
        await configureTaskAction.run(h.accessor);
        expect(h.picks[1].placeholder).toBe(TASK_TEMPLATE_PLACEHOLDER);
        expect(h.picks[1].items.map((i) => [i.label, i.description])).toStrictEqual([
            ["MSBuild", "Executes the build target"],
            ["maven", "Executes common maven commands"],
            [".NET Core", "Executes .NET Core build command"],
            ["Others", "Example to run an arbitrary external command"],
        ]);
        expect(h.tasksJson()).toBe(
            [
                "{",
                "  // See https://go.microsoft.com/fwlink/?LinkId=733558",
                "  // for the documentation about the tasks.json format",
                '  "version": "2.0.0",',
                '  "tasks": [',
                "    {",
                '      "label": "echo",',
                '      "type": "shell",',
                '      "command": "echo Hello"',
                "    }",
                "  ]",
                "}",
            ].join("\n"),
        );
        expect(h.openUri.mock.calls[0][0].fsPath).toBe("/ws/.diode/tasks.json");
        expect((await h.service.getWorkspaceTasks()).map((t) => t._label)).toStrictEqual(["echo"]);
        h.dispose();
    });

    it("отмена шаблона — ничего не пишется и не открывается", async () => {
        const h = build();
        h.answerPicks(CREATE_TASKS_JSON, undefined);
        await configureTaskAction.run(h.accessor);
        expect(h.writeFile).not.toHaveBeenCalled();
        expect(h.openUri).not.toHaveBeenCalled();
        h.dispose();
    });

    it("Open: файл без задач получает ключи шаблона, остальное в нём остаётся", async () => {
        const h = build({ tasksJson: '{\n    // своё\n    "options": { "cwd": "sub" }\n}' });
        h.answerPicks(OPEN_TASKS_JSON, "maven");
        await configureTaskAction.run(h.accessor);
        const written = h.tasksJson() ?? "";
        expect(written).toContain("// своё");
        // Ключи переносит `modify`, соседнее значение он переформатирует — но не теряет.
        expect((await h.service.getWorkspaceTasks())[0].command.options?.cwd).toBe("sub");
        expect((await h.service.getWorkspaceTasks()).map((t) => t._label)).toStrictEqual(["verify", "test"]);
        expect(h.openUri).toHaveBeenCalledTimes(1);
        h.dispose();
    });

    it("Open: битый файл без задач — открыть как есть, без шаблона", async () => {
        const h = build({ tasksJson: "{ oops" });
        h.answerPicks(OPEN_TASKS_JSON);
        await configureTaskAction.run(h.accessor);
        expect(h.picks).toHaveLength(1);
        expect(h.writeFile).not.toHaveBeenCalled();
        expect(h.openUri).toHaveBeenCalledTimes(1);
        h.dispose();
    });
});
