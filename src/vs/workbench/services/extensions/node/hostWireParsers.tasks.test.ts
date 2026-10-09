import { describe, expect, it } from "vitest";

import {
    parseWireTaskExecuteRequest,
    parseWireTaskExecutionId,
    parseWireTaskFilter,
    parseWireTaskFromSubprocess,
    parseWireTaskProviderHandle,
    parseWireTaskProviderRegistration,
    parseWireTasksFromSubprocess,
} from "./hostWireParsers.ts";

// Разбор хостом сообщений `tasks.*` субпроцесса: описание задачи (ответ
// провайдера, `tasks.execute`), регистрации провайдеров, фильтр, id исполнения.

const base = {
    name: "build",
    definition: { type: "demo", target: "a" },
    source: { label: "demo", extensionId: "pub.ext", scope: 2 },
    execution: { commandLine: "make" },
    isBackground: false,
    problemMatchers: [],
    hasDefinedMatchers: false,
};

describe("parseWireTaskFromSubprocess", () => {
    it("минимальная задача: обязательные поля и дефолты необязательных", () => {
        expect(
            parseWireTaskFromSubprocess({
                name: "n",
                definition: { type: "t" },
                source: { label: "l", extensionId: "e", scope: 1 },
            }),
        ).toStrictEqual({
            name: "n",
            execution: undefined,
            definition: { type: "t" },
            isBackground: false,
            source: { label: "l", extensionId: "e", scope: 1 },
            problemMatchers: [],
            hasDefinedMatchers: false,
        });
    });

    it("полная задача: id, группа, detail, presentation (только типизированные поля), матчеры, runOptions", () => {
        expect(
            parseWireTaskFromSubprocess({
                ...base,
                id: "core-id",
                isBackground: true,
                group: { id: "build", isDefault: true },
                detail: "d",
                presentationOptions: {
                    reveal: 2,
                    panel: 3,
                    echo: false,
                    focus: true,
                    showReuseMessage: false,
                    clear: true,
                    close: false,
                    group: "g",
                    bogus: 1,
                    reveal2: "x",
                },
                problemMatchers: ["$a", 1],
                hasDefinedMatchers: true,
                runOptions: { reevaluateOnRerun: false },
                source: { label: "demo", extensionId: "pub.ext", scope: { folder: "/ws" } },
            }),
        ).toStrictEqual({
            id: "core-id",
            name: "build",
            execution: { commandLine: "make" },
            definition: { type: "demo", target: "a" },
            isBackground: true,
            source: { label: "demo", extensionId: "pub.ext", scope: { folder: "/ws" } },
            group: { id: "build", isDefault: true },
            detail: "d",
            presentationOptions: {
                reveal: 2,
                panel: 3,
                echo: false,
                focus: true,
                showReuseMessage: false,
                clear: true,
                close: false,
                group: "g",
            },
            problemMatchers: ["$a"],
            hasDefinedMatchers: true,
            runOptions: { reevaluateOnRerun: false },
        });
    });

    it("битые необязательные поля отбрасываются", () => {
        const parsed = parseWireTaskFromSubprocess({
            ...base,
            id: 1,
            group: { id: 1 },
            detail: 2,
            presentationOptions: "x",
            runOptions: { reevaluateOnRerun: "no" },
            isBackground: "yes",
        });
        expect(parsed).toStrictEqual({ ...base, execution: { commandLine: "make" } });
        expect(parseWireTaskFromSubprocess({ ...base, group: { id: "g", isDefault: "*" } })?.group).toStrictEqual({
            id: "g",
        });
        expect(parseWireTaskFromSubprocess({ ...base, presentationOptions: null })).not.toHaveProperty(
            "presentationOptions",
        );
        expect(
            parseWireTaskFromSubprocess({
                ...base,
                presentationOptions: { reveal: "x", panel: Number.NaN, echo: 1, clear: "y", group: 2 },
            })?.presentationOptions,
        ).toStrictEqual({});
    });

    it("без имени, типа определения, подписи, расширения или области — null", () => {
        expect(parseWireTaskFromSubprocess(null)).toBeNull();
        expect(parseWireTaskFromSubprocess({ ...base, name: 1 })).toBeNull();
        expect(parseWireTaskFromSubprocess({ ...base, definition: {} })).toBeNull();
        expect(parseWireTaskFromSubprocess({ ...base, definition: null })).toBeNull();
        expect(parseWireTaskFromSubprocess({ ...base, source: { ...base.source, label: 1 } })).toBeNull();
        expect(parseWireTaskFromSubprocess({ ...base, source: { ...base.source, extensionId: null } })).toBeNull();
        expect(parseWireTaskFromSubprocess({ ...base, source: { ...base.source, scope: "x" } })).toBeNull();
        expect(parseWireTaskFromSubprocess({ ...base, source: { ...base.source, scope: { folder: 1 } } })).toBeNull();
        expect(parseWireTaskFromSubprocess({ ...base, source: null })).toBeNull();
        expect(parseWireTaskFromSubprocess({ ...base, source: { ...base.source, scope: null } })).toBeNull();
        expect(parseWireTaskFromSubprocess({ ...base, source: { label: "l", extensionId: "e" } })).toBeNull();
    });

    it("исполнение: процесс, шелл командой с аргументами, кастомное, нераспознанное", () => {
        const execution = (value: unknown) => parseWireTaskFromSubprocess({ ...base, execution: value })?.execution;
        expect(
            execution({ process: "node", args: ["a", 1], options: { cwd: "/c", env: { A: "1", N: null, M: 2 } } }),
        ).toStrictEqual({
            process: "node",
            args: ["a"],
            options: { cwd: "/c", env: { A: "1" } },
        });
        expect(execution({ process: "node" })).toStrictEqual({ process: "node", args: [] });
        expect(execution({ process: "node", options: { cwd: 1 } })).toStrictEqual({
            process: "node",
            args: [],
            options: {},
        });
        expect(
            execution({
                command: { value: "my cmd", quoting: 2 },
                args: ["a", { value: "b c", quoting: 1 }, { value: 1 }, { value: "x", quoting: "y" }],
                options: {
                    cwd: "/c",
                    executable: "/bin/zsh",
                    shellArgs: ["-c"],
                    shellQuoting: { escape: { escapeChar: "\\", charsToEscape: " " }, strong: "'", weak: '"' },
                },
            }),
        ).toStrictEqual({
            command: { value: "my cmd", quoting: 2 },
            args: ["a", { value: "b c", quoting: 1 }],
            options: {
                cwd: "/c",
                executable: "/bin/zsh",
                shellArgs: ["-c"],
                shellQuoting: { escape: { escapeChar: "\\", charsToEscape: " " }, strong: "'", weak: '"' },
            },
        });
        expect(execution({ command: "c", options: { shellQuoting: { escape: "^", strong: 1 } } })).toStrictEqual({
            command: "c",
            options: { shellQuoting: { escape: "^" } },
        });
        expect(
            execution({ command: "c", options: { shellQuoting: "x", executable: 1, shellArgs: "x" } }),
        ).toStrictEqual({
            command: "c",
            options: {},
        });
        expect(execution({ command: "c", options: { shellQuoting: { escape: { escapeChar: "\\" } } } })).toStrictEqual({
            command: "c",
            options: { shellQuoting: {} },
        });
        expect(execution({ process: "node", options: null })).toStrictEqual({ process: "node", args: [] });
        expect(execution({ command: "c", options: null })).toStrictEqual({ command: "c" });
        expect(execution({ command: "c", options: { shellQuoting: null, executable: "sh" } })).toStrictEqual({
            command: "c",
            options: { executable: "sh" },
        });
        expect(execution({ command: "c", options: { shellQuoting: { strong: "'" } } })).toStrictEqual({
            command: "c",
            options: { shellQuoting: { strong: "'" } },
        });
        expect(execution({ command: "c", options: { shellQuoting: { escape: null } } })).toStrictEqual({
            command: "c",
            options: { shellQuoting: {} },
        });
        expect(
            execution({ command: "c", options: { shellQuoting: { escape: { charsToEscape: " " } } } }),
        ).toStrictEqual({ command: "c", options: { shellQuoting: {} } });
        expect(execution({ customExecution: "customExecution" })).toStrictEqual({ customExecution: "customExecution" });
        expect(execution({ customExecution: "x" })).toBeUndefined();
        expect(execution({ command: 1 })).toBeUndefined();
        expect(execution(undefined)).toBeUndefined();
    });
});

describe("сообщения tasks.*", () => {
    it("ответ провайдера — массив, битые выпадают; не массив — пусто", () => {
        expect(parseWireTasksFromSubprocess([base, { name: 1 }])).toHaveLength(1);
        expect(parseWireTasksFromSubprocess({})).toStrictEqual([]);
    });

    it("регистрация провайдера и handle", () => {
        expect(parseWireTaskProviderRegistration({ handle: 1, type: "demo", extensionId: "e" })).toStrictEqual({
            handle: 1,
            type: "demo",
            extensionId: "e",
        });
        expect(parseWireTaskProviderRegistration({ handle: "1", type: "demo", extensionId: "e" })).toBeNull();
        expect(parseWireTaskProviderRegistration({ handle: 1, type: 2, extensionId: "e" })).toBeNull();
        expect(parseWireTaskProviderRegistration({ handle: 1, type: "demo" })).toBeNull();
        expect(parseWireTaskProviderRegistration(null)).toBeNull();
        expect(parseWireTaskProviderHandle({ handle: 3 })).toStrictEqual({ handle: 3 });
        expect(parseWireTaskProviderHandle({ handle: Infinity })).toBeNull();
        expect(parseWireTaskProviderHandle(undefined)).toBeNull();
    });

    it("фильтр: тип строкой, иначе без типа", () => {
        expect(parseWireTaskFilter({ type: "npm" })).toStrictEqual({ type: "npm" });
        expect(parseWireTaskFilter({ type: 1 })).toStrictEqual({});
        expect(parseWireTaskFilter(null)).toStrictEqual({});
    });

    it("execute: id, задача целиком или null", () => {
        expect(parseWireTaskExecuteRequest({ id: "x" })).toStrictEqual({ id: "x" });
        expect(parseWireTaskExecuteRequest({ task: base })).toStrictEqual({ task: { ...base } });
        expect(parseWireTaskExecuteRequest({ task: { name: 1 } })).toBeNull();
        expect(parseWireTaskExecuteRequest(undefined)).toBeNull();
    });

    it("id исполнения", () => {
        expect(parseWireTaskExecutionId({ id: "x" })).toStrictEqual({ id: "x" });
        expect(parseWireTaskExecutionId({ id: 1 })).toBeNull();
        expect(parseWireTaskExecutionId(null)).toBeNull();
    });
});
