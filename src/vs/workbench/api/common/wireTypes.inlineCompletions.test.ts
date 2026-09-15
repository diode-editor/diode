import { describe, expect, it } from "vitest";

import { parseWireInlineCompletionItems, requestInlineCompletions, wireToCoreInlineCompletionItems } from "./wireTypes.ts";

// Inline completions (ghost text): best-effort контракт — таймаут/ошибка/мусор
// дают пустой список, невалидные пункты отбрасываются drop+skip.

const WIRE_ITEM = {
    insertText: "console.log()",
    filterText: "console",
    range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 3 },
};

const PARAMS = {
    uri: "file:///a.ts",
    languageId: "typescript",
    text: "con\n",
    line: 0,
    character: 3,
    triggerKind: 1,
};

describe("parseWireInlineCompletionItems", () => {
    it("валидные пункты проходят, мусор и пустой insertText отбрасываются", () => {
        expect(
            parseWireInlineCompletionItems([
                WIRE_ITEM,
                { insertText: "plain" },
                { insertText: "" },
                { insertText: 42 },
                "junk",
                null,
            ]),
        ).toStrictEqual([WIRE_ITEM, { insertText: "plain" }]);
    });

    it("не-массив — пустой список", () => {
        expect(parseWireInlineCompletionItems(null)).toEqual([]);
        expect(parseWireInlineCompletionItems({ items: [WIRE_ITEM] })).toEqual([]);
    });

    it("кривой range отбрасывается, пункт остаётся", () => {
        expect(parseWireInlineCompletionItems([{ insertText: "x", range: { startLine: "a" } }])).toStrictEqual([
            { insertText: "x" },
        ]);
    });
});

describe("wireToCoreInlineCompletionItems", () => {
    it("переводит wire-диапазон в core-IRange", () => {
        expect(wireToCoreInlineCompletionItems([WIRE_ITEM])).toStrictEqual([
            {
                insertText: "console.log()",
                filterText: "console",
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
            },
        ]);
    });

    it("необязательные поля не материализуются", () => {
        expect(wireToCoreInlineCompletionItems([{ insertText: "x" }])).toStrictEqual([{ insertText: "x" }]);
    });
});

describe("requestInlineCompletions", () => {
    it("валидный ответ конвертируется в core-пункты", async () => {
        const result = await requestInlineCompletions(() => Promise.resolve([WIRE_ITEM]), PARAMS, 1000);
        expect(result).toStrictEqual([
            {
                insertText: "console.log()",
                filterText: "console",
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
            },
        ]);
    });

    it("таймаут и ошибка RPC — пустой список", async () => {
        const never = new Promise<unknown>(() => undefined);
        expect(await requestInlineCompletions(() => never, PARAMS, 10)).toEqual([]);
        expect(await requestInlineCompletions(() => Promise.reject(new Error("boom")), PARAMS, 1000)).toEqual([]);
    });

    it("параметры уезжают методом languages.provideInlineCompletions как есть", async () => {
        const calls: { method: string; params: unknown }[] = [];
        await requestInlineCompletions(
            (method, params) => {
                calls.push({ method, params });
                return Promise.resolve([]);
            },
            PARAMS,
            1000,
        );
        expect(calls).toEqual([{ method: "languages.provideInlineCompletions", params: PARAMS }]);
    });
});
