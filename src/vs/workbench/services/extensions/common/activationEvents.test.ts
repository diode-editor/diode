import { describe, expect, it } from "vitest";

import {
    hasWorkspaceContainsPatterns,
    NO_WORKSPACE_CONTAINS_PATTERNS,
    normalizeActivationEvents,
    readActivationEvents,
    readCommandActivationIds,
    readWorkspaceContainsPatterns,
} from "./activationEvents.ts";

describe("normalizeActivationEvents", () => {
    it("отсутствующий список ⇒ eager [*]", () => {
        expect(normalizeActivationEvents(undefined)).toEqual(["*"]);
    });

    it("пустой список ⇒ eager [*]", () => {
        expect(normalizeActivationEvents([])).toEqual(["*"]);
    });

    it("непустой список отдаётся как есть", () => {
        expect(normalizeActivationEvents(["onLanguage:json"])).toEqual(["onLanguage:json"]);
    });
});

describe("readActivationEvents", () => {
    it("манифестные события отдаются как есть", () => {
        expect(readActivationEvents({ activationEvents: ["onStartupFinished", "onLanguage:java"] })).toEqual([
            "onStartupFinished",
            "onLanguage:java",
        ]);
    });

    it("каждая contributes.commands добавляет НЕЯВНОЕ onCommand:<id>", () => {
        expect(
            readActivationEvents({
                activationEvents: ["onLanguage:python"],
                commandTitles: { "ruff.restart": "Restart Server", "ruff.showLogs": "Show client logs" },
            }),
        ).toEqual(["onLanguage:python", "onCommand:ruff.restart", "onCommand:ruff.showLogs"]);
    });

    it("неявное событие не дублирует уже объявленное руками", () => {
        expect(
            readActivationEvents({
                activationEvents: ["onCommand:a.b"],
                commandTitles: { "a.b": "A B" },
            }),
        ).toEqual(["onCommand:a.b"]);
    });

    it("без activationEvents остаётся eager [*] — плюс неявные команды", () => {
        expect(readActivationEvents({ commandTitles: { "a.b": "A B" } })).toEqual(["*", "onCommand:a.b"]);
    });

    it("совсем пустой источник ⇒ [*]", () => {
        expect(readActivationEvents({})).toEqual(["*"]);
    });
});

describe("readCommandActivationIds", () => {
    it("id из onCommand: и из contributes.commands, без дублей", () => {
        expect(
            readCommandActivationIds({
                activationEvents: ["onCommand:_java.templateVariables", "onLanguage:java", "onCommand:x.y"],
                commandTitles: { "x.y": "X Y", "java.clean": "Clean Workspace" },
            }),
        ).toEqual(["_java.templateVariables", "x.y", "java.clean"]);
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
