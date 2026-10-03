import { describe, expect, it } from "vitest";

import { Uri } from "../../base/common/uri.ts";

import { isExclusive, type LanguageSelector, score } from "./languageSelector.ts";

/**
 * Порт upstream `src/vs/editor/test/common/modes/languageSelector.test.ts` без
 * notebook- и `hasAccessToAllModels`-кейсов (у нас их нет — см. шапку
 * languageSelector.ts) плюс наши: `RelativePattern`, `exclusive`.
 */
describe("languageSelector.score", () => {
    const model = { language: "farboo", uri: Uri.parse("file:///testbed/file.fb") };

    it("невалидный селектор — 0", () => {
        expect(score({}, model.uri, model.language)).toBe(0);
        expect(score(undefined, model.uri, model.language)).toBe(0);
        expect(score("", model.uri, model.language)).toBe(0);
        expect(score([], model.uri, model.language)).toBe(0);
    });

    it("любой язык — 5, точный — 10, независимо от схемы", () => {
        expect(score({ language: "*" }, model.uri, model.language)).toBe(5);
        expect(score("*", model.uri, model.language)).toBe(5);
        expect(score("*", Uri.parse("foo:bar"), model.language)).toBe(5);
        expect(score("farboo", Uri.parse("foo:bar"), model.language)).toBe(10);
        expect(score("other", model.uri, model.language)).toBe(0);
    });

    it("схемы: пустая — нет ограничения, `*` — 5, точная — 10", () => {
        const uri = Uri.parse("git:foo/file.txt");
        const language = "farboo";

        expect(score({ language: "farboo", scheme: "" }, uri, language)).toBe(10);
        expect(score({ language: "farboo", scheme: "git" }, uri, language)).toBe(10);
        expect(score({ language: "farboo", scheme: "*" }, uri, language)).toBe(10);
        expect(score({ language: "*" }, uri, language)).toBe(5);
        expect(score({ language: "", scheme: "*" }, uri, language)).toBe(5);

        expect(score({ scheme: "*" }, uri, language)).toBe(5);
        expect(score({ scheme: "git" }, uri, language)).toBe(10);
        expect(score({ scheme: "file" }, uri, language)).toBe(0);
    });

    it("язык `*` не понижает точное совпадение схемы", () => {
        expect(score({ language: "*", scheme: "file" }, model.uri, model.language)).toBe(10);
    });

    it("фильтр: несовпадение любого поля обнуляет", () => {
        expect(score({ language: "farboo" }, model.uri, model.language)).toBe(10);
        expect(score({ language: "farboo", scheme: "file" }, model.uri, model.language)).toBe(10);
        expect(score({ language: "farboo", scheme: "http" }, model.uri, model.language)).toBe(0);
        expect(score({ language: "other", scheme: "*" }, model.uri, model.language)).toBe(0);

        expect(score({ pattern: "**/*.fb" }, model.uri, model.language)).toBe(10);
        expect(score({ pattern: "**/*.fb", scheme: "file" }, model.uri, model.language)).toBe(10);
        expect(score({ pattern: "**/*.fb", scheme: "*" }, model.uri, model.language)).toBe(10);
        expect(score({ pattern: "**/*.fb" }, Uri.parse("foo:bar"), model.language)).toBe(0);
        expect(score({ pattern: "**/*.fb", scheme: "foo" }, Uri.parse("foo:bar"), model.language)).toBe(0);
        expect(score({ pattern: "", language: "*" }, model.uri, model.language)).toBe(5);

        const doc = { uri: Uri.parse("git:/my/file.js"), langId: "javascript" };
        expect(score("javascript", doc.uri, doc.langId)).toBe(10);
        expect(score({ language: "javascript", scheme: "git" }, doc.uri, doc.langId)).toBe(10);
        expect(score("*", doc.uri, doc.langId)).toBe(5);
        expect(score("fooLang", doc.uri, doc.langId)).toBe(0);
        expect(score(["fooLang", "*"], doc.uri, doc.langId)).toBe(5);
    });

    it("массив — максимум по элементам", () => {
        const match = { language: "farboo", scheme: "file" };
        const fail = { language: "farboo", scheme: "http" };

        expect(score([match, fail], model.uri, model.language)).toBe(10);
        expect(score([fail, match], model.uri, model.language)).toBe(10);
        expect(score([fail, fail], model.uri, model.language)).toBe(0);
        expect(score(["farboo", "*"], model.uri, model.language)).toBe(10);
        expect(score(["*", "farboo"], model.uri, model.language)).toBe(10);
        expect(score(["*", "other"], model.uri, model.language)).toBe(5);
    });

    it("pattern + language + scheme вместе (#60232)", () => {
        const selector = { language: "json", scheme: "file", pattern: "**/*.interface.json" };
        expect(score(selector, Uri.parse("file:///C:/Users/zlhe/Desktop/test.interface.json"), "json")).toBe(10);
    });

    it("pattern, равный пути буквально, матчит и с glob-символами в имени", () => {
        // Как glob `{x}` значит альтернативу и путь с фигурными скобками не матчит —
        // спасает только буквальное сравнение.
        expect(score({ pattern: "/a/{x}.ts" }, Uri.file("/a/{x}.ts"), "typescript")).toBe(10);
    });

    it("RelativePattern: шаблон относительно base (#99938)", () => {
        const selector = { pattern: { base: "/home/user/Desktop", pattern: "*.json" } };
        expect(score(selector, Uri.file("/home/user/Desktop/test.json"), "json")).toBe(10);
        expect(score(selector, Uri.file("/home/user/Other/test.json"), "json")).toBe(0);
    });

    it("notebookType без ноутбука не матчит", () => {
        const uri = Uri.parse("file:///my/file.bat");
        expect(score({ language: "bat", notebookType: "xxx" }, uri, "bat")).toBe(0);
        expect(score({ language: "bat", notebookType: "*" }, uri, "bat")).toBe(0);
        expect(score({ language: "bat", notebookType: "" }, uri, "bat")).toBe(10);
    });
});

describe("languageSelector.isExclusive", () => {
    it("строка — никогда, фильтр — по флагу, массив — когда эксклюзивны все", () => {
        const exclusive: LanguageSelector = { language: "a", exclusive: true };
        expect(isExclusive("a")).toBe(false);
        expect(isExclusive({ language: "a" })).toBe(false);
        expect(isExclusive({ language: "a", exclusive: false })).toBe(false);
        expect(isExclusive(exclusive)).toBe(true);
        expect(isExclusive([exclusive, exclusive])).toBe(true);
        expect(isExclusive([exclusive, "a"])).toBe(false);
    });
});
