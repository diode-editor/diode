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
        expect(computeActivationEvents({ activationEvents: ["onStartupFinished", "onLanguage:java"] })).toEqual([
            "onStartupFinished",
            "onLanguage:java",
        ]);
    });

    it("каждая contributes.commands добавляет НЕЯВНОЕ onCommand:<id>", () => {
        expect(
            computeActivationEvents({
                activationEvents: ["onLanguage:python"],
                contributes: {
                    commands: [
                        { command: "ruff.restart", title: "Restart Server" },
                        { command: "ruff.showLogs", title: "Show client logs" },
                    ],
                },
            }),
        ).toEqual(["onLanguage:python", "onCommand:ruff.restart", "onCommand:ruff.showLogs"]);
    });

    it("каждый contributes.languages добавляет НЕЯВНОЕ onLanguage:<id>", () => {
        expect(computeActivationEvents({ contributes: { languages: [{ id: "toml" }, { id: "ini" }] } })).toEqual([
            "onLanguage:toml",
            "onLanguage:ini",
        ]);
    });

    it("неявное событие не дублирует уже объявленное руками", () => {
        expect(
            computeActivationEvents({
                activationEvents: ["onCommand:a.b", "onLanguage:x"],
                contributes: { commands: [{ command: "a.b", title: "A B" }], languages: [{ id: "x" }] },
            }),
        ).toEqual(["onCommand:a.b", "onLanguage:x"]);
    });

    it("записи без строкового id неявных событий не дают", () => {
        expect(
            computeActivationEvents({
                contributes: { commands: [{ title: "No id" } as never], languages: [{} as never] },
            }),
        ).toEqual([]);
    });

    it("эталонный дефолт: без событий и вкладов — пусто, никакого неявного *", () => {
        expect(computeActivationEvents({})).toEqual([]);
        expect(computeActivationEvents({ activationEvents: [] })).toEqual([]);
    });

    it("генераторы перечислены явно — по точке расширения на каждый", () => {
        expect(IMPLICIT_ACTIVATION_EVENT_GENERATORS.map((g) => g.point)).toEqual(["commands", "languages"]);
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
        // Манифест стокового redhat.java: обе семантики одного префикса.
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
