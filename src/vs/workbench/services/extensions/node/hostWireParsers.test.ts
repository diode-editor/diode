import { describe, expect, it } from "vitest";

import {
    parseWireCloseGroupsParams,
    parseWireCloseTabsParams,
    parseWireCreateUntitledParams,
    parseWireEditorEdits,
    parseWireFileStat,
    parseWireFileSystemSchemes,
    parseWireProviderHandle,
    parseWireReadFileResult,
    parseWireShowTextDocumentParams,
    wireToCoreFoldingRegions,
    wireToCoreSemanticTokens,
} from "./hostWireParsers.ts";

describe("hostWireParsers — wireToCoreFoldingRegions", () => {
    it("маппит в IFoldingRegion (несвёрнутые), kind отбрасывается", () => {
        expect(wireToCoreFoldingRegions([{ start: 0, end: 3, kind: 3 }])).toEqual([
            { startLine: 0, endLine: 3, isCollapsed: false },
        ]);
    });

    it("отбрасывает вырожденные (end <= start) и клампит start к нулю", () => {
        expect(
            wireToCoreFoldingRegions([
                { start: 2, end: 2 }, // nothing to hide
                { start: 4, end: 1 }, // end < start
                { start: -3, end: 2 }, // start is clamped to 0
            ]),
        ).toEqual([{ startLine: 0, endLine: 2, isCollapsed: false }]);
    });
});

describe("hostWireParsers — parseWireEditorEdits", () => {
    it("парсит правку с range+text; отбрасывает без range или без text", () => {
        const raw = [
            null,
            42,
            { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }, text: "hi" },
            { text: "no range" },
            { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } } }, // no text
            { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }, text: 5 }, // text is not a string
        ];
        expect(parseWireEditorEdits(raw)).toEqual([
            { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }, text: "hi" },
        ]);
    });

    it("пустой text (delete) валиден", () => {
        const raw = [{ range: { start: { line: 1, character: 0 }, end: { line: 2, character: 0 } }, text: "" }];
        expect(parseWireEditorEdits(raw)).toHaveLength(1);
    });

    it("не-массив → []", () => {
        expect(parseWireEditorEdits(null)).toEqual([]);
    });
});

describe("hostWireParsers — parseWireCreateUntitledParams", () => {
    it("строковые поля берёт, остальные отбрасывает по одному", () => {
        expect(parseWireCreateUntitledParams({ content: "c", language: "go", encoding: "utf8" })).toEqual({
            content: "c",
            language: "go",
            encoding: "utf8",
        });
        expect(parseWireCreateUntitledParams({ content: 1, language: "go", encoding: "utf8" })).toEqual({
            language: "go",
            encoding: "utf8",
        });
        expect(parseWireCreateUntitledParams({ content: "c", language: null, encoding: "utf8" })).toEqual({
            content: "c",
            encoding: "utf8",
        });
        expect(parseWireCreateUntitledParams({ content: "c", language: "go", encoding: true })).toEqual({
            content: "c",
            language: "go",
        });
    });

    it("не объект — пустые опции", () => {
        expect(parseWireCreateUntitledParams(null)).toEqual({});
        expect(parseWireCreateUntitledParams("x")).toEqual({});
        expect(parseWireCreateUntitledParams(undefined)).toEqual({});
    });
});

describe("hostWireParsers — parseWireShowTextDocumentParams", () => {
    it("минимальная форма — только uri; опциональные поля подхватываются", () => {
        expect(parseWireShowTextDocumentParams({ uri: "file:///a.ts" })).toEqual({ uri: "file:///a.ts" });
        expect(parseWireShowTextDocumentParams({ uri: "file:///a.ts", viewColumn: -2, preserveFocus: true })).toEqual({
            uri: "file:///a.ts",
            viewColumn: -2,
            preserveFocus: true,
        });
    });

    it("не-объект и пустой/нестроковый uri → null", () => {
        expect(parseWireShowTextDocumentParams(null)).toBeNull();
        expect(parseWireShowTextDocumentParams("file:///a.ts")).toBeNull();
        expect(parseWireShowTextDocumentParams({})).toBeNull();
        expect(parseWireShowTextDocumentParams({ uri: "" })).toBeNull();
    });

    it("кривые viewColumn/preserveFocus опускаются, uri остаётся", () => {
        expect(
            parseWireShowTextDocumentParams({ uri: "file:///a.ts", viewColumn: "beside", preserveFocus: 1 }),
        ).toEqual({ uri: "file:///a.ts" });
    });

    it("selection-объект парсится в wire-выделение", () => {
        const selection = { anchorLine: 1, anchorCharacter: 2, activeLine: 3, activeCharacter: 4 };
        expect(parseWireShowTextDocumentParams({ uri: "file:///a.ts", selection })).toEqual({
            uri: "file:///a.ts",
            selection,
        });
    });

    it("selection-массив и битый selection-объект опускаются", () => {
        // An array is a foreign shape (this request has exactly one selection).
        const asArray = parseWireShowTextDocumentParams({
            uri: "file:///a.ts",
            selection: [{ anchorLine: 1, anchorCharacter: 2, activeLine: 3, activeCharacter: 4 }],
        });
        expect(asArray?.selection).toBeUndefined();
        const broken = parseWireShowTextDocumentParams({ uri: "file:///a.ts", selection: { anchorLine: "x" } });
        expect(broken?.selection).toBeUndefined();
    });

    it("selection null или массив — поля нет вовсе (не `selection: undefined`)", () => {
        expect(parseWireShowTextDocumentParams({ uri: "file:///a.ts", selection: null })).toStrictEqual({
            uri: "file:///a.ts",
        });
        expect(parseWireShowTextDocumentParams({ uri: "file:///a.ts", selection: [] })).toStrictEqual({
            uri: "file:///a.ts",
        });
        expect(parseWireShowTextDocumentParams({ uri: "file:///a.ts", selection: "x" })).toStrictEqual({
            uri: "file:///a.ts",
        });
    });
});

describe("hostWireParsers — parseWireCloseTabsParams", () => {
    it("парсит адресацию вкладок парами (groupId, uri)", () => {
        const raw = {
            tabs: [
                { groupId: 1, uri: "file:///a.ts" },
                { groupId: 2, uri: "file:///b.ts" },
            ],
        };
        expect(parseWireCloseTabsParams(raw)).toEqual(raw);
    });

    it("не-объект и tabs-не-массив → null", () => {
        expect(parseWireCloseTabsParams(null)).toBeNull();
        expect(parseWireCloseTabsParams("junk")).toBeNull();
        expect(parseWireCloseTabsParams({})).toBeNull();
        expect(parseWireCloseTabsParams({ tabs: {} })).toBeNull();
    });

    it("битая вкладка роняет весь запрос → null (закрыть не то — хуже, чем не закрыть)", () => {
        expect(parseWireCloseTabsParams({ tabs: [null] })).toBeNull();
        expect(parseWireCloseTabsParams({ tabs: [{ groupId: "x", uri: "file:///a.ts" }] })).toBeNull();
        expect(parseWireCloseTabsParams({ tabs: [{ groupId: 1, uri: 42 }] })).toBeNull();
    });
});

describe("hostWireParsers — parseWireCloseGroupsParams", () => {
    it("парсит массив числовых id групп", () => {
        expect(parseWireCloseGroupsParams({ groupIds: [1, 2] })).toEqual({ groupIds: [1, 2] });
        expect(parseWireCloseGroupsParams({ groupIds: [] })).toEqual({ groupIds: [] });
    });

    it("не-объект, не-массив и нечисловой id → null", () => {
        expect(parseWireCloseGroupsParams(null)).toBeNull();
        expect(parseWireCloseGroupsParams("junk")).toBeNull();
        expect(parseWireCloseGroupsParams({})).toBeNull();
        expect(parseWireCloseGroupsParams({ groupIds: [1, "2"] })).toBeNull();
        expect(parseWireCloseGroupsParams({ groupIds: [Number.NaN] })).toBeNull();
    });
});

describe("parseWireFileStat", () => {
    it("метаданные провайдера: type, mtime, size (ctime ядру не нужен)", () => {
        expect(parseWireFileStat({ type: 1, ctime: 0, mtime: 7, size: 3 })).toEqual({ type: 1, mtime: 7, size: 3 });
    });

    it("null — ресурса нет", () => {
        expect(parseWireFileStat(null)).toBeNull();
    });

    it.each([undefined, 42, "строка", { type: 1, mtime: 1 }, { type: "1", mtime: 1, size: 1 }])(
        "чужая форма (%s) — ошибка",
        (raw) => {
            expect(() => parseWireFileStat(raw)).toThrow(/workspace\.fs\.stat/);
        },
    );
});

describe("parseWireFileSystemSchemes", () => {
    it("readonly — подмножество схем; лишнее в readonly отбрасывается", () => {
        expect(parseWireFileSystemSchemes({ schemes: ["git", "_claude_fs_right"], readonly: ["git", "nope"] })).toEqual(
            { schemes: ["git", "_claude_fs_right"], readonly: ["git"] },
        );
    });

    it("без поля readonly (старый субпроцесс) — все схемы только для чтения", () => {
        expect(parseWireFileSystemSchemes({ schemes: ["git"] })).toEqual({ schemes: ["git"], readonly: ["git"] });
        expect(parseWireFileSystemSchemes(null)).toEqual({ schemes: [], readonly: [] });
    });
});

describe("parseWireReadFileResult", () => {
    it("разбирает base64 в байты", () => {
        const content = Buffer.from("оригинал", "utf8").toString("base64");
        expect(new TextDecoder().decode(parseWireReadFileResult({ content }))).toBe("оригинал");
    });

    it("пустое содержимое — валидный результат", () => {
        expect(parseWireReadFileResult({ content: "" })).toEqual(new Uint8Array());
    });

    it.each([null, undefined, 42, "строка", []])("структурно чужой ответ (%s) — ошибка", (raw) => {
        expect(() => parseWireReadFileResult(raw)).toThrow(/workspace\.fs\.readFile/);
    });

    it("нестроковый content — ошибка", () => {
        expect(() => parseWireReadFileResult({ content: 42 })).toThrow(/base64 string/);
    });
});

/** Only such an input distinguishes the `typeof raw !== "object"` check from the field checks after it. */
function fnWith(fields: Record<string, unknown>): unknown {
    return Object.assign(() => undefined, fields);
}

describe("hostWireParsers — editor.*: не-объект с нужными полями отвергается", () => {
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };

    it("showTextDocument: функция с uri → null", () => {
        expect(parseWireShowTextDocumentParams(fnWith({ uri: "file:///a" }))).toBeNull();
    });

    it("closeTabs: функция-конверт и функция-вкладка → null", () => {
        expect(parseWireCloseTabsParams(fnWith({ tabs: [] }))).toBeNull();
        expect(parseWireCloseTabsParams({ tabs: [fnWith({ groupId: 1, uri: "file:///a" })] })).toBeNull();
    });

    it("closeGroups: функция с groupIds → null", () => {
        expect(parseWireCloseGroupsParams(fnWith({ groupIds: [1] }))).toBeNull();
    });

    it("editorEdits: функция-правка отбрасывается", () => {
        expect(parseWireEditorEdits([fnWith({ range, text: "x" })])).toEqual([]);
    });
});

describe("hostWireParsers — parseWireProviderHandle", () => {
    it("целый handle проходит, остальное — null", () => {
        expect(parseWireProviderHandle({ handle: 3 })).toStrictEqual({ handle: 3 });
        expect(parseWireProviderHandle({ handle: 0, extra: 1 })).toStrictEqual({ handle: 0 });
        for (const raw of [null, undefined, 5, {}, { handle: "3" }, { handle: 1.5 }]) {
            expect(parseWireProviderHandle(raw)).toBeNull();
        }
    });
});

describe("hostWireParsers — wireToCoreSemanticTokens", () => {
    it("null остаётся null", () => {
        expect(wireToCoreSemanticTokens(null)).toBeNull();
    });

    it("полный ответ: id строкой в resultId, данные — Uint32Array", () => {
        const result = wireToCoreSemanticTokens({ id: 7, type: "full", data: [0, 1, 2, 3, 4] });
        expect(result).toStrictEqual({ resultId: "7", data: new Uint32Array([0, 1, 2, 3, 4]) });
    });

    it("дельта: правки с Uint32Array, правка без данных — data undefined", () => {
        const result = wireToCoreSemanticTokens({
            id: 0,
            type: "delta",
            deltas: [
                { start: 5, deleteCount: 2, data: [9, 8] },
                { start: 10, deleteCount: 1 },
            ],
        });
        expect(result).toStrictEqual({
            resultId: "0",
            edits: [
                { start: 5, deleteCount: 2, data: new Uint32Array([9, 8]) },
                { start: 10, deleteCount: 1, data: undefined },
            ],
        });
    });
});
