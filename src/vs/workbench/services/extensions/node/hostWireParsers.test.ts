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
    it("maps to IFoldingRegion (expanded), drops kind", () => {
        expect(wireToCoreFoldingRegions([{ start: 0, end: 3, kind: 3 }])).toEqual([
            { startLine: 0, endLine: 3, isCollapsed: false },
        ]);
    });

    it("drops degenerate ranges (end <= start) and clamps start to zero", () => {
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
    it("parses an edit with range+text; drops ones without range or text", () => {
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

    it("empty text (delete) is valid", () => {
        const raw = [{ range: { start: { line: 1, character: 0 }, end: { line: 2, character: 0 } }, text: "" }];
        expect(parseWireEditorEdits(raw)).toHaveLength(1);
    });

    it("non-array → []", () => {
        expect(parseWireEditorEdits(null)).toEqual([]);
    });
});

describe("hostWireParsers — parseWireCreateUntitledParams", () => {
    it("takes string fields, drops the rest one by one", () => {
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

    it("non-object yields empty options", () => {
        expect(parseWireCreateUntitledParams(null)).toEqual({});
        expect(parseWireCreateUntitledParams("x")).toEqual({});
        expect(parseWireCreateUntitledParams(undefined)).toEqual({});
    });
});

describe("hostWireParsers — parseWireShowTextDocumentParams", () => {
    it("minimal form is just uri; optional fields are picked up", () => {
        expect(parseWireShowTextDocumentParams({ uri: "file:///a.ts" })).toEqual({ uri: "file:///a.ts" });
        expect(parseWireShowTextDocumentParams({ uri: "file:///a.ts", viewColumn: -2, preserveFocus: true })).toEqual({
            uri: "file:///a.ts",
            viewColumn: -2,
            preserveFocus: true,
        });
    });

    it("non-object and empty/non-string uri → null", () => {
        expect(parseWireShowTextDocumentParams(null)).toBeNull();
        expect(parseWireShowTextDocumentParams("file:///a.ts")).toBeNull();
        expect(parseWireShowTextDocumentParams({})).toBeNull();
        expect(parseWireShowTextDocumentParams({ uri: "" })).toBeNull();
    });

    it("malformed viewColumn/preserveFocus are omitted, uri stays", () => {
        expect(
            parseWireShowTextDocumentParams({ uri: "file:///a.ts", viewColumn: "beside", preserveFocus: 1 }),
        ).toEqual({ uri: "file:///a.ts" });
    });

    it("selection object parses into a wire selection", () => {
        const selection = { anchorLine: 1, anchorCharacter: 2, activeLine: 3, activeCharacter: 4 };
        expect(parseWireShowTextDocumentParams({ uri: "file:///a.ts", selection })).toEqual({
            uri: "file:///a.ts",
            selection,
        });
    });

    it("selection array and malformed selection object are omitted", () => {
        // An array is a foreign shape (this request has exactly one selection).
        const asArray = parseWireShowTextDocumentParams({
            uri: "file:///a.ts",
            selection: [{ anchorLine: 1, anchorCharacter: 2, activeLine: 3, activeCharacter: 4 }],
        });
        expect(asArray?.selection).toBeUndefined();
        const broken = parseWireShowTextDocumentParams({ uri: "file:///a.ts", selection: { anchorLine: "x" } });
        expect(broken?.selection).toBeUndefined();
    });

    it("selection null or array: the field is absent entirely (not `selection: undefined`)", () => {
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
    it("parses tab addresses as (groupId, uri) pairs", () => {
        const raw = {
            tabs: [
                { groupId: 1, uri: "file:///a.ts" },
                { groupId: 2, uri: "file:///b.ts" },
            ],
        };
        expect(parseWireCloseTabsParams(raw)).toEqual(raw);
    });

    it("non-object and non-array tabs → null", () => {
        expect(parseWireCloseTabsParams(null)).toBeNull();
        expect(parseWireCloseTabsParams("junk")).toBeNull();
        expect(parseWireCloseTabsParams({})).toBeNull();
        expect(parseWireCloseTabsParams({ tabs: {} })).toBeNull();
    });

    it("a malformed tab fails the whole request → null (closing the wrong tab is worse than closing none)", () => {
        expect(parseWireCloseTabsParams({ tabs: [null] })).toBeNull();
        expect(parseWireCloseTabsParams({ tabs: [{ groupId: "x", uri: "file:///a.ts" }] })).toBeNull();
        expect(parseWireCloseTabsParams({ tabs: [{ groupId: 1, uri: 42 }] })).toBeNull();
    });
});

describe("hostWireParsers — parseWireCloseGroupsParams", () => {
    it("parses an array of numeric group ids", () => {
        expect(parseWireCloseGroupsParams({ groupIds: [1, 2] })).toEqual({ groupIds: [1, 2] });
        expect(parseWireCloseGroupsParams({ groupIds: [] })).toEqual({ groupIds: [] });
    });

    it("non-object, non-array and non-numeric id → null", () => {
        expect(parseWireCloseGroupsParams(null)).toBeNull();
        expect(parseWireCloseGroupsParams("junk")).toBeNull();
        expect(parseWireCloseGroupsParams({})).toBeNull();
        expect(parseWireCloseGroupsParams({ groupIds: [1, "2"] })).toBeNull();
        expect(parseWireCloseGroupsParams({ groupIds: [Number.NaN] })).toBeNull();
    });
});

describe("parseWireFileStat", () => {
    it("provider metadata: type, mtime, size (core does not need ctime)", () => {
        expect(parseWireFileStat({ type: 1, ctime: 0, mtime: 7, size: 3 })).toEqual({ type: 1, mtime: 7, size: 3 });
    });

    it("null means no resource", () => {
        expect(parseWireFileStat(null)).toBeNull();
    });

    it.each([undefined, 42, "string", { type: 1, mtime: 1 }, { type: "1", mtime: 1, size: 1 }])(
        "foreign shape (%s) throws",
        (raw) => {
            expect(() => parseWireFileStat(raw)).toThrow(/workspace\.fs\.stat/);
        },
    );
});

describe("parseWireFileSystemSchemes", () => {
    it("readonly is a subset of schemes; extras in readonly are dropped", () => {
        expect(parseWireFileSystemSchemes({ schemes: ["git", "_claude_fs_right"], readonly: ["git", "nope"] })).toEqual(
            { schemes: ["git", "_claude_fs_right"], readonly: ["git"] },
        );
    });

    it("without a readonly field (old subprocess) all schemes are read-only", () => {
        expect(parseWireFileSystemSchemes({ schemes: ["git"] })).toEqual({ schemes: ["git"], readonly: ["git"] });
        expect(parseWireFileSystemSchemes(null)).toEqual({ schemes: [], readonly: [] });
    });
});

describe("parseWireReadFileResult", () => {
    it("decodes base64 into bytes", () => {
        const content = Buffer.from("original", "utf8").toString("base64");
        expect(new TextDecoder().decode(parseWireReadFileResult({ content }))).toBe("original");
    });

    it("empty content is a valid result", () => {
        expect(parseWireReadFileResult({ content: "" })).toEqual(new Uint8Array());
    });

    it.each([null, undefined, 42, "string", []])("structurally foreign response (%s) throws", (raw) => {
        expect(() => parseWireReadFileResult(raw)).toThrow(/workspace\.fs\.readFile/);
    });

    it("non-string content throws", () => {
        expect(() => parseWireReadFileResult({ content: 42 })).toThrow(/base64 string/);
    });
});

/** Only such an input distinguishes the `typeof raw !== "object"` check from the field checks after it. */
function fnWith(fields: Record<string, unknown>): unknown {
    return Object.assign(() => undefined, fields);
}

describe("hostWireParsers — editor.*: non-object with the right fields is rejected", () => {
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };

    it("showTextDocument: function with uri → null", () => {
        expect(parseWireShowTextDocumentParams(fnWith({ uri: "file:///a" }))).toBeNull();
    });

    it("closeTabs: function envelope and function tab → null", () => {
        expect(parseWireCloseTabsParams(fnWith({ tabs: [] }))).toBeNull();
        expect(parseWireCloseTabsParams({ tabs: [fnWith({ groupId: 1, uri: "file:///a" })] })).toBeNull();
    });

    it("closeGroups: function with groupIds → null", () => {
        expect(parseWireCloseGroupsParams(fnWith({ groupIds: [1] }))).toBeNull();
    });

    it("editorEdits: function edit is dropped", () => {
        expect(parseWireEditorEdits([fnWith({ range, text: "x" })])).toEqual([]);
    });
});

describe("hostWireParsers — parseWireProviderHandle", () => {
    it("integer handle passes, anything else is null", () => {
        expect(parseWireProviderHandle({ handle: 3 })).toStrictEqual({ handle: 3 });
        expect(parseWireProviderHandle({ handle: 0, extra: 1 })).toStrictEqual({ handle: 0 });
        for (const raw of [null, undefined, 5, {}, { handle: "3" }, { handle: 1.5 }]) {
            expect(parseWireProviderHandle(raw)).toBeNull();
        }
    });
});

describe("hostWireParsers — wireToCoreSemanticTokens", () => {
    it("null stays null", () => {
        expect(wireToCoreSemanticTokens(null)).toBeNull();
    });

    it("full response: id as string in resultId, data as Uint32Array", () => {
        const result = wireToCoreSemanticTokens({ id: 7, type: "full", data: [0, 1, 2, 3, 4] });
        expect(result).toStrictEqual({ resultId: "7", data: new Uint32Array([0, 1, 2, 3, 4]) });
    });

    it("delta: edits with Uint32Array, an edit without data has data undefined", () => {
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
