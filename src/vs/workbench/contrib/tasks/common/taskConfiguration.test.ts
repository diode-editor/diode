import { describe, expect, it } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";
import type { IWorkspaceFolder } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";

import { currentTaskPlatform, parseTasksJson } from "./taskConfiguration.ts";
import { DEFAULT_PRESENTATION, DEFAULT_RUN_OPTIONS } from "./tasks.ts";

// Разбор `.diode/tasks.json` — подмножество схемы 2.0.0 первой итерации.

const folder: IWorkspaceFolder = { uri: Uri.file("/ws"), name: "ws", index: 0 };

function parse(json: unknown, platform: "linux" | "osx" | "windows" = "linux") {
    return parseTasksJson(JSON.stringify(json), folder, platform);
}

function one(task: unknown, extra: Record<string, unknown> = {}) {
    const { tasks, problems } = parse({ version: "2.0.0", ...extra, tasks: [task] });
    return { task: tasks.at(0), problems };
}

describe("parseTasksJson — задача shell/process", () => {
    it("полная форма задачи tasks.json", () => {
        const { task, problems } = one({
            label: "build",
            type: "shell",
            command: "make",
            args: ["all", { value: "a b", quoting: "escape" }],
            options: { cwd: "sub", env: { A: "1", N: 2 }, shell: { executable: "/bin/zsh", args: ["-c"] } },
            presentation: {
                echo: false,
                reveal: "Silent",
                focus: true,
                panel: "dedicated",
                showReuseMessage: false,
                clear: true,
                group: "g",
                close: true,
            },
            detail: "Builds it",
            hide: false,
            isBackground: true,
            group: "build",
            problemMatcher: "$tsc",
            runOptions: { reevaluateOnRerun: false, instancePolicy: "silent" },
        });
        expect(problems).toStrictEqual([]);
        expect(task).toStrictEqual({
            _id: "$core.build",
            _label: "build",
            name: "build",
            type: "shell",
            source: { kind: "workspace", label: "Workspace", folder },
            definition: { type: "shell", _key: "$core.build", id: "$core.build" },
            command: {
                runtime: "shell",
                name: "make",
                args: ["all", { value: "a b", quoting: "escape" }],
                options: { cwd: "sub", env: { A: "1" }, shell: { executable: "/bin/zsh", args: ["-c"] } },
                presentation: {
                    echo: false,
                    reveal: "silent",
                    focus: true,
                    panel: "dedicated",
                    showReuseMessage: false,
                    clear: true,
                    group: "g",
                    close: true,
                },
            },
            isBackground: true,
            detail: "Builds it",
            hide: false,
            group: { id: "build" },
            problemMatchers: ["$tsc"],
            hasDefinedMatchers: true,
            runOptions: { reevaluateOnRerun: false, instanceLimit: 1, instancePolicy: "silent" },
        });
    });

    it("минимальная: без типа — процесс; cwd по умолчанию — ${workspaceFolder}; дефолты presentation и runOptions", () => {
        const { task } = one({ label: "t", command: "node" });
        expect(task?.type).toBe("process");
        expect(task?.command).toStrictEqual({
            runtime: "process",
            name: "node",
            args: [],
            options: { cwd: "${workspaceFolder}" },
            presentation: DEFAULT_PRESENTATION,
        });
        expect(task?.runOptions).toBe(DEFAULT_RUN_OPTIONS);
        expect(task?.problemMatchers).toStrictEqual([]);
        expect(task?.hasDefinedMatchers).toBe(false);
        expect(task?.isBackground).toBe(false);
        expect(task).not.toHaveProperty("detail");
        expect(task).not.toHaveProperty("hide");
        expect(task).not.toHaveProperty("group");
    });

    it("type: process и null — процесс; isWatching (устаревший) — фоновая", () => {
        expect(one({ label: "t", type: "process", command: "x" }).task?.type).toBe("process");
        expect(one({ label: "t", type: null, command: "x", isWatching: true }).task?.isBackground).toBe(true);
    });

    it("команда массивом и {value: массив} — через пробел; quoting неизвестный — strong", () => {
        expect(one({ label: "t", command: ["a", "b"] }).task?.command.name).toBe("a b");
        // Массив не только из строк — не команда.
        expect(one({ label: "t", command: ["a", 1] }).task).toBeUndefined();
        expect(one({ label: "t", command: { value: ["a", "b"], quoting: "weak" } }).task?.command.name).toStrictEqual({
            value: "a b",
            quoting: "weak",
        });
        expect(one({ label: "t", command: { value: "a", quoting: "loud" } }).task?.command.name).toStrictEqual({
            value: "a",
            quoting: "strong",
        });
    });

    it("неверный аргумент — ошибка эталона и пропуск аргумента", () => {
        const { task, problems } = one({ label: "t", command: "x", args: ["ok", 5, { value: "" }] });
        expect(task?.command.args).toStrictEqual(["ok"]);
        expect(problems).toStrictEqual([
            "Error: command argument must either be a string or a quoted string. Provided value is:\n5",
            'Error: command argument must either be a string or a quoted string. Provided value is:\n{\n    "value": ""\n}',
        ]);
    });

    it("нестроковый options.cwd — предупреждение, остаётся cwd по умолчанию", () => {
        const { task, problems } = one({ label: "t", command: "x", options: { cwd: 3 } });
        expect(task?.command.options).toStrictEqual({ cwd: "${workspaceFolder}" });
        expect(problems).toStrictEqual(["Warning: options.cwd must be of type string. Ignoring value 3"]);
    });

    it("presentation: неизвестные reveal/panel — always/shared; лишние типы полей пропускаются", () => {
        const { task } = one({
            label: "t",
            command: "x",
            presentation: { reveal: "x", panel: "Y", echo: "no", group: 1 },
        });
        expect(task?.command.presentation).toStrictEqual({
            ...DEFAULT_PRESENTATION,
            reveal: "always",
            panel: "shared",
        });
        expect(
            one({ label: "t", command: "x", presentation: { reveal: "NEVER", panel: "New" } }).task?.command
                .presentation,
        ).toMatchObject({
            reveal: "never",
            panel: "new",
        });
    });

    it("шелл: quoting с escape-строкой или объектом, мусор в шелле — без полей", () => {
        const options = (shell: unknown) => one({ label: "t", command: "x", options: { shell } }).task?.command.options;
        expect(options({ quoting: { escape: "^", strong: "'", weak: '"' } })).toStrictEqual({
            cwd: "${workspaceFolder}",
            shell: { quoting: { escape: "^", strong: "'", weak: '"' } },
        });
        expect(options({ quoting: { escape: { escapeChar: "\\", charsToEscape: " " } } })).toStrictEqual({
            cwd: "${workspaceFolder}",
            shell: { quoting: { escape: { escapeChar: "\\", charsToEscape: " " } } },
        });
        // Объект escape — только с обоими полями строками.
        for (const escape of [{ escapeChar: "\\" }, { charsToEscape: " " }, { escapeChar: 1, charsToEscape: " " }]) {
            expect(options({ quoting: { escape } })).toStrictEqual({
                cwd: "${workspaceFolder}",
                shell: { quoting: {} },
            });
        }
        expect(options({ executable: 1, args: [1], quoting: { escape: { escapeChar: 1 } } })).toStrictEqual({
            cwd: "${workspaceFolder}",
            shell: { quoting: {} },
        });
        expect(options("bash")).toStrictEqual({ cwd: "${workspaceFolder}" });
    });

    it("runOptions: неизвестная политика — prompt; reevaluateOnRerun не булево — дефолт", () => {
        expect(
            one({ label: "t", command: "x", runOptions: { instancePolicy: "x", reevaluateOnRerun: 1 } }).task
                ?.runOptions,
        ).toStrictEqual(DEFAULT_RUN_OPTIONS);
        for (const policy of ["terminateNewest", "terminateOldest", "prompt", "warn", "silent"]) {
            expect(
                one({ label: "t", command: "x", runOptions: { instancePolicy: policy } }).task?.runOptions
                    .instancePolicy,
            ).toBe(policy);
        }
    });

    it("group: объект с kind и isDefault; без kind или числом — без группы", () => {
        expect(one({ label: "t", command: "x", group: { kind: "test", isDefault: true } }).task?.group).toStrictEqual({
            id: "test",
            isDefault: true,
        });
        expect(
            one({ label: "t", command: "x", group: { kind: "build", isDefault: "*.ts" } }).task?.group,
        ).toStrictEqual({ id: "build" });
        expect(one({ label: "t", command: "x", group: { isDefault: true } }).task).not.toHaveProperty("group");
        expect(one({ label: "t", command: "x", group: 1 }).task).not.toHaveProperty("group");
    });

    it("problemMatcher массивом — строки; не строка и не массив — нет матчеров", () => {
        expect(one({ label: "t", command: "x", problemMatcher: ["$a", 1, "$b"] }).task?.problemMatchers).toStrictEqual([
            "$a",
            "$b",
        ]);
        expect(one({ label: "t", command: "x", problemMatcher: { owner: "x" } }).task?.problemMatchers).toStrictEqual(
            [],
        );
    });
});

describe("parseTasksJson — неподдержанное и ошибки", () => {
    it("без label — ошибка эталона; без команды — ошибка эталона; задача пропускается", () => {
        const noLabel = one({ type: "shell", command: "x" });
        expect(noLabel.task).toBeUndefined();
        expect(noLabel.problems[0]).toMatch(
            /^Error: a task must provide a label property\. The task will be ignored\.\n\{/u,
        );
        const emptyLabel = one({ label: "", command: "x" });
        expect(emptyLabel.task).toBeUndefined();
        expect(one({ label: 5, command: "x" }).task).toBeUndefined();
        // Команда-объект без строкового значения — команды нет.
        expect(one({ label: "t", command: { value: 1 } }).task).toBeUndefined();
        const noCommand = one({ label: "t" });
        expect(noCommand.task).toBeUndefined();
        expect(noCommand.problems[0]).toMatch(
            /^Error: the task 't' neither specifies a command nor a dependsOn property\. The task will be ignored\. Its definition is:\n/u,
        );
    });

    it("запись с типом провайдера — предупреждение, задача не попадает в список", () => {
        const { task, problems } = one({ label: "b", type: "bazel", target: "//a" });
        expect(task).toBeUndefined();
        expect(problems[0]).toMatch(
            /^Warning: task of type 'bazel' customizes a task of an extension; this is not supported yet\./u,
        );
    });

    it("dependsOn, runOn folderOpen, instanceLimit > 1, inputs — предупреждения, задача остаётся", () => {
        const { task, problems } = one(
            { label: "t", command: "x", dependsOn: ["a"], runOptions: { runOn: "folderOpen", instanceLimit: 3 } },
            { inputs: [] },
        );
        expect(task?.runOptions.instanceLimit).toBe(1);
        expect(problems).toStrictEqual([
            "Warning: tasks.json inputs are not supported; tasks that use ${input:...} fail to start.",
            "Warning: task 't': dependsOn is not supported; the task runs without its dependencies.",
            "Warning: task 't': runOptions.runOn \"folderOpen\" is not supported; the task runs only when started.",
            "Warning: task 't': runOptions.instanceLimit greater than 1 is not supported; one instance runs at a time.",
        ]);
        expect(
            one({ label: "t", command: "x", runOptions: { runOn: "default", instanceLimit: 1 } }).problems,
        ).toStrictEqual([]);
        // Лимит не числом — не лимит; опции без cwd — без предупреждения о cwd.
        expect(one({ label: "t", command: "x", runOptions: { instanceLimit: "5" } }).problems).toStrictEqual([]);
        expect(one({ label: "t", command: "x", options: { env: { A: "1" } } }).problems).toStrictEqual([]);
    });

    it("битый JSON — ни одной задачи и ошибка с кодом; комментарии и висячие запятые — можно", () => {
        const broken = parseTasksJson('{ "version": "2.0.0", "tasks": [ }', folder, "linux");
        expect(broken.tasks).toStrictEqual([]);
        expect(broken.problems[0]).toBe(
            "Error: The content of the tasks.json file has syntax errors. Please correct them before executing a task.",
        );
        expect(broken.problems[1]).toMatch(/^\w+ at offset \d+\.$/u);
        const jsonc = parseTasksJson(
            '{ // c\n "version": "2.0.0", "tasks": [ { "label": "a", "command": "x", }, ], }',
            folder,
            "linux",
        );
        expect(jsonc.tasks).toHaveLength(1);
        expect(jsonc.problems).toStrictEqual([]);
    });

    it("версия не 2.0.0 — ни одной задачи и ошибка; не объект и без tasks — пусто молча", () => {
        expect(parse({ version: "0.1.0", tasks: [{ label: "a", command: "x" }] })).toStrictEqual({
            tasks: [],
            problems: ["Error: tasks.json version '0.1.0' is not supported. Use version \"2.0.0\"."],
        });
        expect(parse([1])).toStrictEqual({ tasks: [], problems: [] });
        expect(parse({ version: "2.0.0" })).toStrictEqual({ tasks: [], problems: [] });
        expect(parse({ version: "2.0.0", tasks: [1, null] })).toStrictEqual({ tasks: [], problems: [] });
    });
});

describe("parseTasksJson — платформа и глобальные опции", () => {
    it("секция платформы перекрывает команду и аргументы, опции и presentation сливаются", () => {
        const task = {
            label: "t",
            command: "base",
            args: ["b"],
            options: { cwd: "/base", env: { A: "1", B: "1" } },
            presentation: { echo: false },
            linux: { command: "lin", args: ["l"], options: { env: { B: "2" } }, presentation: { focus: true } },
            windows: { command: "win" },
        };
        const linux = one(task).task;
        expect(linux?.command.name).toBe("lin");
        expect(linux?.command.args).toStrictEqual(["l"]);
        expect(linux?.command.options).toStrictEqual({ cwd: "/base", env: { A: "1", B: "2" } });
        expect(linux?.command.presentation).toMatchObject({ echo: false, focus: true });
        expect(parse({ version: "2.0.0", tasks: [task] }, "windows").tasks[0].command.name).toBe("win");
        // Секции osx нет — база как есть.
        const osx = parse({ version: "2.0.0", tasks: [task] }, "osx").tasks[0];
        expect(osx.command.name).toBe("base");
        expect(osx.command.args).toStrictEqual(["b"]);
    });

    it("глобальные options и presentation — под опциями задачи; шелл задачи поверх глобального", () => {
        const { task } = one(
            {
                label: "t",
                command: "x",
                options: { env: { B: "t" }, shell: { args: ["-l"] } },
                presentation: { echo: true },
            },
            {
                options: { cwd: "/g", env: { A: "g", B: "g" }, shell: { executable: "/bin/sh" } },
                presentation: { echo: false, clear: true },
            },
        );
        expect(task?.command.options).toStrictEqual({
            cwd: "/g",
            env: { A: "g", B: "t" },
            shell: { executable: "/bin/sh", args: ["-l"] },
        });
        expect(task?.command.presentation).toMatchObject({ echo: true, clear: true });
    });

    it("секция платформы на верхнем уровне — тоже глобальные опции", () => {
        const { task } = one({ label: "t", command: "x" }, { linux: { options: { env: { L: "1" } } } });
        expect(task?.command.options).toStrictEqual({ cwd: "${workspaceFolder}", env: { L: "1" } });
    });
});

describe("currentTaskPlatform", () => {
    it("win32 → windows, darwin → osx, прочее → linux", () => {
        expect(currentTaskPlatform("win32")).toBe("windows");
        expect(currentTaskPlatform("darwin")).toBe("osx");
        expect(currentTaskPlatform("linux")).toBe("linux");
        expect(currentTaskPlatform("freebsd")).toBe("linux");
        expect(["windows", "osx", "linux"]).toContain(currentTaskPlatform());
    });
});
