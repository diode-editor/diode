import { describe, expect, it, vi } from "vitest";

import { makeTask, TASK_FOLDER } from "../../../../../TestUtils/taskFixtures.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ITaskDefinitionSchema } from "../../../api/common/taskIdentity.ts";
import type { IWireTask } from "../../../api/common/taskWireTypes.ts";

import { type ITaskFromWireContext, taskFromWire, taskToWire } from "./taskDto.ts";
import { DEFAULT_PRESENTATION, DEFAULT_RUN_OPTIONS } from "./tasks.ts";

// Задача ядра ↔ описание расширений (`TaskDTO.to`/`from` эталона).

const other = { uri: Uri.file("/other"), name: "other", index: 1 };
const schema: ITaskDefinitionSchema = {
    extensionId: "pub.ext",
    taskType: "demo",
    required: ["target"],
    properties: { target: { type: "string" } },
    when: undefined,
};

function context(overrides: Partial<ITaskFromWireContext> = {}): ITaskFromWireContext {
    return {
        folders: [TASK_FOLDER, other],
        schemaOf: (type) => (type === "demo" ? schema : undefined),
        report: () => undefined,
        ...overrides,
    };
}

const wire = (overrides: Partial<IWireTask> = {}): IWireTask => ({
    name: "build",
    execution: { commandLine: "make" },
    definition: { type: "demo", target: "a", extra: 1 },
    isBackground: false,
    source: { label: "demo", extensionId: "pub.ext", scope: 2 },
    problemMatchers: [],
    hasDefinedMatchers: false,
    ...overrides,
});

describe("taskFromWire", () => {
    it("задача провайдера: id по ключу определения из схемы, подпись «source: name», первая папка", () => {
        const task = taskFromWire(wire(), context());
        expect(task).toStrictEqual({
            _id: "pub.ext.target,a,type,demo,",
            _label: "demo: build",
            name: "build",
            type: "demo",
            source: { kind: "extension", label: "demo", extensionId: "pub.ext", scope: "folder", folder: TASK_FOLDER },
            definition: { type: "demo", target: "a", _key: "target,a,type,demo," },
            command: { runtime: "shell", name: "make", args: [], presentation: DEFAULT_PRESENTATION },
            isBackground: false,
            problemMatchers: [],
            hasDefinedMatchers: false,
            runOptions: DEFAULT_RUN_OPTIONS,
        });
    });

    it("без исполнения — задачи нет", () => {
        expect(taskFromWire(wire({ execution: undefined }), context())).toBeUndefined();
    });

    it("область: глобальная — без папки; воркспейс без папок — глобальная; папка — по пути, чужая — без папки", () => {
        expect(
            taskFromWire(wire({ source: { label: "s", extensionId: "e", scope: 1 } }), context())?.source,
        ).toMatchObject({
            scope: "global",
            folder: undefined,
        });
        expect(taskFromWire(wire(), context({ folders: [] }))?.source).toMatchObject({
            scope: "global",
            folder: undefined,
        });
        expect(
            taskFromWire(wire({ source: { label: "s", extensionId: "e", scope: { folder: "/other" } } }), context())
                ?.source,
        ).toMatchObject({
            kind: "extension",
            scope: "folder",
            folder: other,
        });
        expect(
            taskFromWire(wire({ source: { label: "s", extensionId: "e", scope: { folder: "/nope" } } }), context())
                ?.source,
        ).toMatchObject({
            scope: "folder",
            folder: undefined,
        });
    });

    it("определение не проходит схему — «только исполнить», со случайным ключом и сообщением", () => {
        const report = vi.fn();
        const task = taskFromWire(
            wire({ definition: { type: "demo" } }),
            context({ schemaOf: () => ({ ...schema, properties: { target: { type: "object" } } }), report }),
        );
        expect(task?.definition.type).toBe("$executeOnly");
        expect(task?.definition._key).toMatch(/^[0-9a-f-]{36}$/u);
        expect(task?.type).toBe("$executeOnly");
        expect(report).toHaveBeenCalledTimes(1);
    });

    it("процесс: аргументы, cwd по умолчанию ${workspaceFolder}, env", () => {
        expect(
            taskFromWire(wire({ execution: { process: "node", args: ["a"], options: { env: { A: "1" } } } }), context())
                ?.command,
        ).toStrictEqual({
            runtime: "process",
            name: "node",
            args: ["a"],
            options: { cwd: "${workspaceFolder}", env: { A: "1" } },
            presentation: DEFAULT_PRESENTATION,
        });
        expect(
            taskFromWire(wire({ execution: { process: "node", args: [], options: { cwd: "/c" } } }), context())?.command
                .options,
        ).toStrictEqual({
            cwd: "/c",
        });
    });

    it("шелл командой: правила кавычек числами; options.shell — только с исполняемым файлом", () => {
        const command = taskFromWire(
            wire({
                execution: {
                    command: { value: "my cmd", quoting: 3 },
                    args: ["a", { value: "b", quoting: 1 }, { value: "c", quoting: 9 }],
                    options: {
                        cwd: "/c",
                        env: { A: "1" },
                        executable: "/bin/zsh",
                        shellArgs: ["-l"],
                        shellQuoting: { strong: "'" },
                    },
                },
            }),
            context(),
        )?.command;
        expect(command).toStrictEqual({
            runtime: "shell",
            name: { value: "my cmd", quoting: "weak" },
            args: ["a", { value: "b", quoting: "escape" }, { value: "c", quoting: "strong" }],
            options: {
                cwd: "/c",
                env: { A: "1" },
                shell: { executable: "/bin/zsh", args: ["-l"], quoting: { strong: "'" } },
            },
            presentation: DEFAULT_PRESENTATION,
        });
        expect(
            taskFromWire(wire({ execution: { command: "c", options: { shellArgs: ["-l"] } } }), context())?.command
                .options,
        ).toStrictEqual({});
        expect(
            taskFromWire(wire({ execution: { command: "c", options: { executable: "sh" } } }), context())?.command
                .options,
        ).toStrictEqual({
            shell: { executable: "sh" },
        });
        expect(taskFromWire(wire({ execution: {} }), context())?.command.name).toBe("");
    });

    it("presentation — числа enum'ов поверх дефолтов; неизвестные числа — дефолт", () => {
        const presentation = (p: IWireTask["presentationOptions"]) =>
            taskFromWire(wire({ presentationOptions: p }), context())?.command.presentation;
        expect(
            presentation({
                reveal: 3,
                panel: 2,
                echo: false,
                focus: true,
                showReuseMessage: false,
                clear: true,
                group: "g",
                close: true,
            }),
        ).toStrictEqual({
            echo: false,
            reveal: "never",
            focus: true,
            panel: "dedicated",
            showReuseMessage: false,
            clear: true,
            group: "g",
            close: true,
        });
        expect(presentation({ reveal: 2, panel: 3 })).toStrictEqual({
            ...DEFAULT_PRESENTATION,
            reveal: "silent",
            panel: "new",
        });
        expect(presentation({ reveal: 1, panel: 1 })).toStrictEqual(DEFAULT_PRESENTATION);
        expect(presentation({ reveal: 7, panel: 0 })).toStrictEqual(DEFAULT_PRESENTATION);
    });

    it("кастомное исполнение: id из ядра сохраняется; прочее — поля как есть", () => {
        const task = taskFromWire(
            wire({
                id: "kept",
                execution: { customExecution: "customExecution" },
                detail: "d",
                group: { id: "build", isDefault: true },
                isBackground: true,
                problemMatchers: ["$m"],
                hasDefinedMatchers: true,
                runOptions: { reevaluateOnRerun: false },
            }),
            context(),
        );
        expect(task).toMatchObject({
            _id: "kept",
            command: { runtime: "custom", presentation: DEFAULT_PRESENTATION },
            detail: "d",
            group: { id: "build", isDefault: true },
            isBackground: true,
            problemMatchers: ["$m"],
            hasDefinedMatchers: true,
            runOptions: { ...DEFAULT_RUN_OPTIONS, reevaluateOnRerun: false },
        });
        // У не-кастомной задачи присланный id не берётся — только формула.
        expect(taskFromWire(wire({ id: "ignored" }), context())?._id).toBe("pub.ext.target,a,type,demo,");
    });
});

describe("taskToWire", () => {
    it("задача tasks.json: $core, папка, командная строка, presentation числами, без _key", () => {
        expect(taskToWire(makeTask({ label: "a", command: { name: "make" } }))).toStrictEqual({
            id: "$core.a",
            name: "a",
            execution: { commandLine: "make" },
            definition: { type: "shell" },
            isBackground: false,
            source: { label: "Workspace", extensionId: "$core", scope: { folder: "/ws" } },
            presentationOptions: {
                echo: true,
                reveal: 1,
                focus: false,
                panel: 1,
                showReuseMessage: true,
                clear: false,
            },
            problemMatchers: [],
            hasDefinedMatchers: false,
            runOptions: { reevaluateOnRerun: true },
        });
    });

    it("шелл с аргументами и опциями шелла; процесс; кастомное", () => {
        expect(
            taskToWire(
                makeTask({
                    command: {
                        name: { value: "c", quoting: "weak" },
                        args: ["a", { value: "b", quoting: "escape" }],
                        options: {
                            cwd: "/c",
                            env: { A: "1" },
                            shell: { executable: "zsh", args: ["-l"], quoting: { strong: "'" } },
                        },
                    },
                    presentation: { reveal: "never", panel: "new", group: "g", close: true },
                    detail: "d",
                }),
            ),
        ).toMatchObject({
            execution: {
                command: { value: "c", quoting: 3 },
                args: ["a", { value: "b", quoting: 1 }],
                options: {
                    cwd: "/c",
                    env: { A: "1" },
                    executable: "zsh",
                    shellArgs: ["-l"],
                    shellQuoting: { strong: "'" },
                },
            },
            presentationOptions: { reveal: 3, panel: 3, group: "g", close: true },
            detail: "d",
        });
        expect(taskToWire(makeTask({ command: { name: { value: "c", quoting: "strong" } } })).execution).toStrictEqual({
            command: { value: "c", quoting: 2 },
            args: [],
        });
        expect(taskToWire(makeTask({ command: { name: "c", args: ["x"] } })).execution).toStrictEqual({
            command: "c",
            args: ["x"],
        });
        expect(taskToWire(makeTask({ command: { options: {} } })).execution).toStrictEqual({
            commandLine: "echo build",
            options: {},
        });
        expect(
            taskToWire(
                makeTask({
                    command: {
                        runtime: "process",
                        name: { value: "node", quoting: "strong" },
                        args: ["a", { value: "b", quoting: "weak" }],
                        options: { cwd: "/c" },
                    },
                }),
            ).execution,
        ).toStrictEqual({ process: "node", args: ["a", "b"], options: { cwd: "/c" } });
        expect(
            taskToWire(makeTask({ command: { runtime: "process", name: undefined, args: undefined } })).execution,
        ).toStrictEqual({
            process: "",
            args: [],
        });
        expect(taskToWire(makeTask({ command: { runtime: "custom" } })).execution).toStrictEqual({
            customExecution: "customExecution",
        });
    });

    it("задача провайдера: расширение и область — папка, воркспейс без папки, глобальная; группа", () => {
        const ext = { type: "demo", extensionId: "pub.ext", source: "demo" };
        expect(taskToWire(makeTask({ extension: ext, definition: { target: "x" } })).source).toStrictEqual({
            label: "demo",
            extensionId: "pub.ext",
            scope: { folder: "/ws" },
        });
        expect(taskToWire(makeTask({ extension: ext, folder: null })).source.scope).toBe(2);
        const global = { ...makeTask({ extension: ext, folder: null }) };
        expect(
            taskToWire({ ...global, source: { ...global.source, scope: "global" } as typeof global.source }).source
                .scope,
        ).toBe(1);
        const workspace = makeTask();
        expect(
            taskToWire({ ...workspace, source: { kind: "workspace", label: "Workspace", folder: undefined as never } })
                .source.scope,
        ).toBe(1);
        expect(taskToWire({ ...workspace, group: { id: "test" } }).group).toStrictEqual({ id: "test" });
        expect(taskToWire(makeTask({ extension: ext, definition: { target: "x" } })).definition).toStrictEqual({
            type: "demo",
            target: "x",
        });
    });
});
