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
    /** Task command is `npm run <script>`. */
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

describe("Configure Task — picker", () => {
    it("no own tasks and no file: provider tasks and 'Create tasks.json file from template'", async () => {
        const h = build();
        h.withNpm(["lint", "build"]);
        h.answerPicks(undefined);
        await configureTaskAction.run(h.accessor);
        expect(h.picks[0].placeholder).toBe(CONFIGURE_TASK_PLACEHOLDER);
        expect(h.lastPickLabels()).toStrictEqual(["npm: build", "npm: lint", CREATE_TASKS_JSON]);
        expect(h.writeFile).not.toHaveBeenCalled();
        h.dispose();
    });

    it("file exists but has no tasks — 'Open tasks.json file'; own tasks exist — no file item", async () => {
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

    it("a single own task and nothing else — no picker: the file opens at its entry", async () => {
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

    it("own task among several — the file at its entry; cancel — nothing", async () => {
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

    it("without a folder — picker without the file item, picking writes nothing", async () => {
        const h = build({ folder: null });
        h.withNpm(["lint"]);
        h.answerPicks("npm: lint");
        await configureTaskAction.run(h.accessor);
        expect(h.lastPickLabels()).toStrictEqual(["npm: lint"]);
        expect(h.writeFile).not.toHaveBeenCalled();
        h.dispose();
    });
});

describe("Configure Task — opening at the entry", () => {
    const twoTasks = tasksJsonOf([
        { label: "a", command: "x" },
        { label: "b", command: "y" },
    ]);

    it("file failed to open — the cursor is not touched anywhere (neither without an editor nor in another one)", async () => {
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

    it("file changed between reads and the entry is gone — the file opens, the cursor stays", async () => {
        const h = build({ tasksJson: twoTasks });
        // The first read is the service's task list, the second is the text to locate the entry in.
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

describe("Configure Task — provider task customization", () => {
    it("no file: tasks.json is created (the directory too) with the upstream entry, opened at the entry", async () => {
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

    it("file exists: the entry is appended to the end of tasks, comments and formatting are intact", async () => {
        const text = [
            "{",
            "\t// my tasks",
            '\t"version": "2.0.0",',
            '\t"tasks": [',
            '\t\t{ "label": "a", "command": "x" } // first',
            "\t]",
            "}",
        ].join("\n");
        const h = build({ tasksJson: text, settings: { "editor.insertSpaces": false } });
        h.withNpm(["lint"]);
        h.answerPicks("npm: lint");
        await configureTaskAction.run(h.accessor);
        // The neighbor entry and its trailing comment stay as they were; the new one goes on its own lines before `]`.
        expect(h.tasksJson()).toBe(
            [
                "{",
                "\t// my tasks",
                '\t"version": "2.0.0",',
                '\t"tasks": [',
                '\t\t{ "label": "a", "command": "x" }, // first',
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

    it("the appended entry is a 'configured' task in Run Task under its own label, running it runs the provider command", async () => {
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

    it("Configure Task opens a customized task at its entry instead of appending a second one", async () => {
        const h = build({ tasksJson: tasksJsonOf([{ type: "npm", script: "lint", label: "L" }]) });
        h.withNpm(["lint"]);
        await configureTaskAction.run(h.accessor);
        expect(h.picks).toHaveLength(0);
        expect(h.writeFile).not.toHaveBeenCalled();
        expect(h.opened()?.goToPosition).toHaveBeenCalledWith(0, (h.tasksJson() ?? "").indexOf('{"type"'));
        h.dispose();
    });

    it("broken tasks.json — upstream warning, the file is left alone", async () => {
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

    it("tasks.json open with unsaved edits — upstream error; a clean one is re-read", async () => {
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

describe("Configure Task — templates", () => {
    it("Create: upstream template picker; the picked one is written with the editor indent and opened", async () => {
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

    it("cancelled template — nothing is written or opened", async () => {
        const h = build();
        h.answerPicks(CREATE_TASKS_JSON, undefined);
        await configureTaskAction.run(h.accessor);
        expect(h.writeFile).not.toHaveBeenCalled();
        expect(h.openUri).not.toHaveBeenCalled();
        h.dispose();
    });

    it("Open: a file without tasks gets the template keys, the rest of it stays", async () => {
        const h = build({ tasksJson: '{\n    // mine\n    "options": { "cwd": "sub" }\n}' });
        h.answerPicks(OPEN_TASKS_JSON, "maven");
        await configureTaskAction.run(h.accessor);
        const written = h.tasksJson() ?? "";
        expect(written).toContain("// mine");
        // `modify` moves the keys and reformats the neighboring value, but does not lose it.
        expect((await h.service.getWorkspaceTasks())[0].command.options?.cwd).toBe("sub");
        expect((await h.service.getWorkspaceTasks()).map((t) => t._label)).toStrictEqual(["verify", "test"]);
        expect(h.openUri).toHaveBeenCalledTimes(1);
        h.dispose();
    });

    it("Open: a broken file without tasks opens as is, without a template", async () => {
        const h = build({ tasksJson: "{ oops" });
        h.answerPicks(OPEN_TASKS_JSON);
        await configureTaskAction.run(h.accessor);
        expect(h.picks).toHaveLength(1);
        expect(h.writeFile).not.toHaveBeenCalled();
        expect(h.openUri).toHaveBeenCalledTimes(1);
        h.dispose();
    });
});
