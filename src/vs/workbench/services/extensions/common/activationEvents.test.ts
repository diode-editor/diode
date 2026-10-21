import { describe, expect, it } from "vitest";

import {
    computeActivationEvents,
    hasWorkspaceContainsPatterns,
    IMPLICIT_ACTIVATION_EVENT_GENERATORS,
    NO_WORKSPACE_CONTAINS_PATTERNS,
    readActivationEvents,
    readCommandActivationIds,
    readWorkspaceContainsPatterns,
} from "./activationEvents.ts";

describe("computeActivationEvents", () => {
    it("объявленные события отдаются как есть", () => {
        expect(
            computeActivationEvents({ activationEvents: ["onStartupFinished", "onLanguage:java"] }, "pub.ext"),
        ).toEqual(["onStartupFinished", "onLanguage:java"]);
    });

    it("каждая contributes.commands добавляет НЕЯВНОЕ onCommand:<id>", () => {
        expect(
            computeActivationEvents(
                {
                    activationEvents: ["onLanguage:python"],
                    contributes: {
                        commands: [
                            { command: "ruff.restart", title: "Restart Server" },
                            { command: "ruff.showLogs", title: "Show client logs" },
                        ],
                    },
                },
                "pub.ext",
            ),
        ).toEqual(["onLanguage:python", "onCommand:ruff.restart", "onCommand:ruff.showLogs"]);
    });

    it("каждый contributes.languages добавляет НЕЯВНОЕ onLanguage:<id>", () => {
        expect(
            computeActivationEvents(
                {
                    activationEvents: ["onStartupFinished"],
                    contributes: { languages: [{ id: "toml" }, { id: "ini" }] },
                },
                "pub.ext",
            ),
        ).toEqual(["onStartupFinished", "onLanguage:toml", "onLanguage:ini"]);
    });

    it("каждый contributes.taskDefinitions добавляет НЕЯВНОЕ onTaskType:<type>; без типа или с пустым — нет", () => {
        expect(
            computeActivationEvents(
                {
                    activationEvents: ["onStartupFinished"],
                    contributes: { taskDefinitions: [{ type: "bazel" }, {}, { type: "" }, { type: "npm" }] },
                },
                "pub.ext",
            ),
        ).toEqual(["onStartupFinished", "onTaskType:bazel", "onTaskType:npm"]);
    });

    it("неявное событие не дублирует уже объявленное руками", () => {
        expect(
            computeActivationEvents(
                {
                    activationEvents: ["onCommand:a.b", "onLanguage:x"],
                    contributes: { commands: [{ command: "a.b", title: "A B" }], languages: [{ id: "x" }] },
                },
                "pub.ext",
            ),
        ).toEqual(["onCommand:a.b", "onLanguage:x"]);
    });

    it("записи без строкового id неявных событий не дают", () => {
        expect(
            computeActivationEvents(
                {
                    activationEvents: ["onStartupFinished"],
                    contributes: { commands: [{ title: "No id" } as never], languages: [{} as never] },
                },
                "pub.ext",
            ),
        ).toEqual(["onStartupFinished"]);
    });

    it("манифест без событий — eager * (отклонение от эталона ради опубликованных расширений), плюс неявные", () => {
        expect(computeActivationEvents({}, "pub.ext")).toEqual(["*"]);
        expect(computeActivationEvents({ activationEvents: [] }, "pub.ext")).toEqual(["*"]);
        expect(
            computeActivationEvents({ contributes: { commands: [{ command: "a.b", title: "A" }] } }, "pub.ext"),
        ).toEqual(["*", "onCommand:a.b"]);
    });

    it("голый onUri — onUri:<id в нижнем регистре>, с аргументом — как есть", () => {
        expect(
            computeActivationEvents({ activationEvents: ["onUri", "onUri:other.ext", "onStartupFinished"] }, "Pub.Ext"),
        ).toEqual(["onUri:pub.ext", "onUri:other.ext", "onStartupFinished"]);
    });

    it("генераторы перечислены явно — по точке расширения на каждый", () => {
        expect(IMPLICIT_ACTIVATION_EVENT_GENERATORS.map((g) => g.point)).toEqual([
            "commands",
            "languages",
            "taskDefinitions",
        ]);
    });
});

describe("readActivationEvents", () => {
    it("отдаёт посчитанный набор регистрации как есть", () => {
        expect(readActivationEvents({ activationEvents: ["*", "onCommand:a.b"] })).toEqual(["*", "onCommand:a.b"]);
    });

    it("регистрация без событий — пусто", () => {
        expect(readActivationEvents({})).toEqual([]);
    });
});

describe("readCommandActivationIds", () => {
    it("id из onCommand:, без дублей, в порядке набора", () => {
        expect(
            readCommandActivationIds({
                activationEvents: [
                    "onCommand:_java.templateVariables",
                    "onLanguage:java",
                    "onCommand:x.y",
                    "onCommand:x.y",
                ],
            }),
        ).toEqual(["_java.templateVariables", "x.y"]);
    });

    it("расширение без команд не даёт ни одного id", () => {
        expect(readCommandActivationIds({ activationEvents: ["onLanguage:java"] })).toEqual([]);
    });

    it("пустой id (`onCommand:`) отбрасывается", () => {
        expect(readCommandActivationIds({ activationEvents: ["onCommand:"] })).toEqual([]);
    });
});

describe("readWorkspaceContainsPatterns", () => {
    it("паттерн без glob-символов уходит в paths, с ними — в globs", () => {
        // Manifest of the stock redhat.java: both semantics of one prefix.
        expect(
            readWorkspaceContainsPatterns({
                activationEvents: [
                    "workspaceContains:pom.xml",
                    "workspaceContains:*/pom.xml",
                    "workspaceContains:.classpath",
                    "workspaceContains:*/.classpath",
                    "onLanguage:java",
                ],
            }),
        ).toEqual({
            paths: ["pom.xml", ".classpath"],
            globs: ["*/pom.xml", "*/.classpath"],
        });
    });

    it("`?` тоже делает паттерн glob'ом", () => {
        expect(readWorkspaceContainsPatterns({ activationEvents: ["workspaceContains:pom?.xml"] })).toEqual({
            paths: [],
            globs: ["pom?.xml"],
        });
    });

    it("рекурсивный `**/` остаётся glob'ом", () => {
        expect(readWorkspaceContainsPatterns({ activationEvents: ["workspaceContains:**/pyproject.toml"] })).toEqual({
            paths: [],
            globs: ["**/pyproject.toml"],
        });
    });

    it("пустой паттерн отбрасывается — иначе матчил бы любой воркспейс", () => {
        expect(readWorkspaceContainsPatterns({ activationEvents: ["workspaceContains:"] })).toEqual({
            paths: [],
            globs: [],
        });
    });

    it("дубли схлопываются", () => {
        expect(
            readWorkspaceContainsPatterns({
                activationEvents: ["workspaceContains:pom.xml", "workspaceContains:pom.xml"],
            }),
        ).toEqual({ paths: ["pom.xml"], globs: [] });
    });

    it("расширение без workspaceContains даёт пустой набор", () => {
        expect(readWorkspaceContainsPatterns({ activationEvents: ["onStartupFinished"] })).toEqual({
            paths: [],
            globs: [],
        });
    });

    it("eager-дефолт [*] не читается как workspaceContains", () => {
        expect(readWorkspaceContainsPatterns({})).toEqual({ paths: [], globs: [] });
    });

    it("префикс-самозванец (`workspaceContainsX:`) не подхватывается", () => {
        expect(readWorkspaceContainsPatterns({ activationEvents: ["workspaceContainsNot:pom.xml"] })).toEqual({
            paths: [],
            globs: [],
        });
    });
});

describe("hasWorkspaceContainsPatterns", () => {
    it("пустой набор — нечего считать", () => {
        expect(hasWorkspaceContainsPatterns(NO_WORKSPACE_CONTAINS_PATTERNS)).toBe(false);
    });

    it("только paths — считать есть что", () => {
        expect(hasWorkspaceContainsPatterns({ paths: ["pom.xml"], globs: [] })).toBe(true);
    });

    it("только globs — считать есть что", () => {
        expect(hasWorkspaceContainsPatterns({ paths: [], globs: ["*/pom.xml"] })).toBe(true);
    });
});
