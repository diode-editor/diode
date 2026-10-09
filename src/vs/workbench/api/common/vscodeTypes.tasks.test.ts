import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { Uri } from "../../../base/common/uri.ts";

import { CustomExecution, ProcessExecution, ShellExecution, Task, TaskGroup, TaskScope } from "./vscodeTypes.ts";

// Value-типы задач (`extHostTypes.ts` эталона): провайдер расширения
// конструирует их сам, ядро читает поля и `handleId`.

const folder = { uri: Uri.file("/ws"), name: "ws", index: 0 } as unknown as vscode.WorkspaceFolder;

describe("TaskGroup", () => {
    it("встроенные группы по id; неизвестная — undefined; id/label/isDefault", () => {
        expect(TaskGroup.from("build")).toBe(TaskGroup.Build);
        expect(TaskGroup.from("clean")).toBe(TaskGroup.Clean);
        expect(TaskGroup.from("rebuild")).toBe(TaskGroup.Rebuild);
        expect(TaskGroup.from("test")).toBe(TaskGroup.Test);
        expect(TaskGroup.from("other")).toBeUndefined();
        const group = new TaskGroup("lint", "Lint");
        expect([group.id, group.label, group.isDefault]).toStrictEqual(["lint", "Lint", undefined]);
    });

    it("не строки — отказ", () => {
        expect(() => new TaskGroup(1 as unknown as string, "x")).toThrow("Illegal argument: name");
        expect(() => new TaskGroup("x", 1 as unknown as string)).toThrow("Illegal argument: name");
    });
});

describe("ProcessExecution", () => {
    it("перегрузки: (process, options) и (process, args, options); сеттеры", () => {
        const withOptions = new ProcessExecution("node", { cwd: "/c" });
        expect([withOptions.process, withOptions.args, withOptions.options]).toStrictEqual(["node", [], { cwd: "/c" }]);
        const withArgs = new ProcessExecution("node", ["a"], { env: { A: "1" } });
        expect([withArgs.args, withArgs.options]).toStrictEqual([["a"], { env: { A: "1" } }]);
        const bare = new ProcessExecution("x");
        expect(bare.options).toBeUndefined();
        bare.process = "y";
        bare.args = "z" as unknown as string[];
        bare.options = { cwd: "/" };
        expect([bare.process, bare.args, bare.options]).toStrictEqual(["y", [], { cwd: "/" }]);
        bare.args = ["q"];
        expect(bare.args).toStrictEqual(["q"]);
    });

    it("не строка — отказ; computeId — значения с удвоенными запятыми", () => {
        expect(() => new ProcessExecution(1 as unknown as string)).toThrow("Illegal argument: process");
        expect(() => {
            new ProcessExecution("x").process = 1 as unknown as string;
        }).toThrow("Illegal argument: process");
        expect(new ProcessExecution("a,b", ["c"]).computeId()).toBe("process,a,,b,c,");
    });
});

describe("ShellExecution", () => {
    it("командная строка или команда с аргументами; сеттеры", () => {
        const line = new ShellExecution("make all", { cwd: "/c" });
        expect([line.commandLine, line.command, line.args, line.options]).toStrictEqual([
            "make all",
            "",
            [],
            { cwd: "/c" },
        ]);
        const quoted = { value: "a b", quoting: 2 } as vscode.ShellQuotedString;
        const command = new ShellExecution(quoted, ["x"], { executable: "/bin/zsh" });
        expect([command.commandLine, command.command, command.args, command.options]).toStrictEqual([
            undefined,
            quoted,
            ["x"],
            { executable: "/bin/zsh" },
        ]);
        command.commandLine = "z";
        command.command = "c";
        command.args = undefined;
        command.options = undefined;
        expect([command.commandLine, command.command, command.args, command.options]).toStrictEqual([
            "z",
            "c",
            [],
            undefined,
        ]);
    });

    it("отказы на неверных командах", () => {
        expect(() => new ShellExecution("", [])).toThrow("Illegal argument: command can't be undefined or null");
        expect(() => new ShellExecution({} as vscode.ShellQuotedString, [])).toThrow("Illegal argument: command");
        expect(() => new ShellExecution(null as unknown as string, [])).toThrow("Illegal argument: command");
        expect(() => new ShellExecution(1 as unknown as string)).toThrow("Illegal argument: commandLine");
        const execution = new ShellExecution("x");
        expect(() => {
            execution.commandLine = undefined;
        }).toThrow("Illegal argument: commandLine");
        expect(() => {
            execution.command = {} as vscode.ShellQuotedString;
        }).toThrow("Illegal argument: command");
        expect(() => {
            execution.command = null as unknown as string;
        }).toThrow("Illegal argument: command");
        execution.command = { value: "ok", quoting: 1 } as vscode.ShellQuotedString;
        expect(execution.command).toStrictEqual({ value: "ok", quoting: 1 });
    });

    it("computeId: shell, строка, команда, аргументы (значения строк в кавычках)", () => {
        expect(new ShellExecution("a,b").computeId()).toBe("shell,a,,b,");
        expect(new ShellExecution("c", ["x", { value: "y", quoting: 1 } as vscode.ShellQuotedString]).computeId()).toBe(
            "shell,c,x,y,",
        );
        expect(new ShellExecution({ value: "q", quoting: 1 } as vscode.ShellQuotedString, []).computeId()).toBe(
            "shell,q,",
        );
    });
});

describe("CustomExecution", () => {
    it("колбэк — поле; id — уникальный с префиксом", () => {
        const callback = (): Thenable<vscode.Pseudoterminal> => Promise.resolve({} as vscode.Pseudoterminal);
        const execution = new CustomExecution(callback);
        expect(execution.callback).toBe(callback);
        expect(execution.computeId()).toMatch(/^customExecution[0-9a-f-]{36}$/u);
        expect(execution.computeId()).not.toBe(execution.computeId());
    });
});

describe("Task", () => {
    it("конструктор с областью: поля и дефолты", () => {
        const execution = new ShellExecution("make");
        const task = new Task({ type: "demo", target: "a" }, TaskScope.Workspace, "build", "demo", execution, "$tsc");
        expect(task.definition).toStrictEqual({ type: "demo", target: "a" });
        expect([task.scope, task.name, task.source, task.execution]).toStrictEqual([
            TaskScope.Workspace,
            "build",
            "demo",
            execution,
        ]);
        expect([task.problemMatchers, task.hasDefinedMatchers, task.isBackground]).toStrictEqual([
            ["$tsc"],
            true,
            false,
        ]);
        expect([task.group, task.detail, task.handleId, task.deprecated]).toStrictEqual([
            undefined,
            undefined,
            undefined,
            false,
        ]);
        expect({ ...task.presentationOptions }).toStrictEqual({});
        expect({ ...task.runOptions }).toStrictEqual({});
        expect(new Task({ type: "t" }, folder, "n", "s", undefined, ["a", "b"]).problemMatchers).toStrictEqual([
            "a",
            "b",
        ]);
        expect(new Task({ type: "t" }, folder, "n", "s").hasDefinedMatchers).toBe(false);
        expect(new Task({ type: "t" }, folder, "n", "s").problemMatchers).toStrictEqual([]);
        expect(new Task({ type: "t" }, folder, "n", "s").scope).toBe(folder);
    });

    it("устаревший конструктор без области", () => {
        const task = new Task({ type: "t" }, "n", "s", new ShellExecution("x"), "$m");
        expect([task.scope, task.name, task.source, task.deprecated, task.problemMatchers]).toStrictEqual([
            undefined,
            "n",
            "s",
            true,
            ["$m"],
        ]);
    });

    it("определение встроенного типа считается по исполнению", () => {
        expect(new Task({ type: "shell" }, folder, "n", "s", new ShellExecution("a b")).definition).toStrictEqual({
            type: "shell",
            id: "shell,a b,",
        });
        expect(new Task({ type: "process" }, folder, "n", "s", new ProcessExecution("p")).definition).toStrictEqual({
            type: "process",
            id: "process,p,",
        });
        const custom = new Task(
            { type: "customExecution" },
            folder,
            "n",
            "s",
            new CustomExecution(() => Promise.resolve({} as vscode.Pseudoterminal)),
        );
        expect(custom.definition.id).toMatch(/^customExecution/u);
        const empty = new Task({ type: "$empty" }, folder, "n", "s");
        expect(empty.definition.type).toBe("$empty");
        expect(empty.definition.id).toMatch(/^[0-9a-f-]{36}$/u);
        // Тип провайдера по исполнению не пересчитывается.
        expect(new Task({ type: "demo" }, folder, "n", "s", new ShellExecution("x")).definition).toStrictEqual({
            type: "demo",
        });
    });

    it("сеттер сбрасывает id ядра и область; определение «пустого» типа — по исполнению", () => {
        const fresh = (): Task => {
            const task = new Task({ type: "shell" }, folder, "n", "s", new ShellExecution("x"));
            task.handleId = "core-id";
            return task;
        };
        const mutations: ((task: Task) => void)[] = [
            (t) => (t.name = "m"),
            (t) => (t.source = "src"),
            (t) => (t.isBackground = true),
            (t) => (t.group = TaskGroup.Build),
            (t) => (t.presentationOptions = {}),
            (t) => (t.runOptions = {}),
            (t) => (t.problemMatchers = ["$x"]),
            (t) => (t.execution = new ShellExecution("y")),
            (t) => (t.target = TaskScope.Global),
        ];
        for (const mutate of mutations) {
            const task = fresh();
            mutate(task);
            expect(task.handleId).toBeUndefined();
        }
        const task = fresh();
        task.name = "renamed";
        expect(task.scope).toBeUndefined();
        expect(task.definition).toStrictEqual({ type: "shell", id: "shell,x," });
        // Сброс пересчитывает определение по исполнению и у задачи своего типа (как у эталона).
        const typed = new Task({ type: "demo" }, folder, "n", "s", new ShellExecution("x"));
        typed.handleId = "core-id";
        typed.name = "renamed";
        expect(typed.definition).toStrictEqual({ type: "shell", id: "shell,x," });
        // detail id не сбрасывает (как у эталона).
        const kept = fresh();
        kept.detail = "d";
        expect(kept.handleId).toBe("core-id");
        // Новое определение — после сброса.
        const redefined = fresh();
        redefined.definition = { type: "demo", target: "x" };
        expect([redefined.handleId, redefined.definition]).toStrictEqual([undefined, { type: "demo", target: "x" }]);
    });

    it("сеттеры: нормализация значений", () => {
        const task = new Task({ type: "demo" }, folder, "n", "s");
        task.isBackground = "yes" as unknown as boolean;
        expect(task.isBackground).toBe(false);
        task.isBackground = true;
        expect(task.isBackground).toBe(true);
        task.group = null as unknown as undefined;
        expect(task.group).toBeUndefined();
        task.detail = null as unknown as undefined;
        expect(task.detail).toBeUndefined();
        task.presentationOptions = null as unknown as vscode.TaskPresentationOptions;
        expect({ ...task.presentationOptions }).toStrictEqual({});
        task.runOptions = undefined as unknown as vscode.RunOptions;
        expect({ ...task.runOptions }).toStrictEqual({});
        task.problemMatchers = ["$tsc"];
        expect([task.problemMatchers, task.hasDefinedMatchers]).toStrictEqual([["$tsc"], true]);
        task.problemMatchers = "x" as unknown as string[];
        expect([task.problemMatchers, task.hasDefinedMatchers]).toStrictEqual([[], false]);
        task.execution = null as unknown as undefined;
        expect(task.execution).toBeUndefined();
    });

    it("отказы: определение, имя и источник", () => {
        const task = new Task({ type: "demo" }, folder, "n", "s");
        expect(() => {
            task.definition = undefined as unknown as vscode.TaskDefinition;
        }).toThrow("Kind can't be undefined or null");
        expect(() => {
            task.definition = null as unknown as vscode.TaskDefinition;
        }).toThrow("Kind can't be undefined or null");
        expect(() => {
            task.name = 1 as unknown as string;
        }).toThrow("Illegal argument: name");
        expect(() => new Task({ type: "demo" }, folder, "n", "")).toThrow("source must be a string of length > 0");
        expect(() => {
            task.source = 1 as unknown as string;
        }).toThrow("source must be a string of length > 0");
    });
});
