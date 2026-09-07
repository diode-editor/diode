import { describe, expect, it } from "vitest";

import { createRange } from "../../../editor/common/core/iRange.ts";

import { parseWireReferences, requestReferences, wireToCoreReferences } from "./wireTypes.ts";

const RANGE = { startLine: 7, startCharacter: 4, endLine: 7, endCharacter: 9 };
const PARAMS = {
    uri: "file:///a.ts",
    languageId: "typescript",
    text: "const a = 1;\n",
    line: 0,
    character: 6,
    includeDeclaration: true,
};

describe("wireTypes — parseWireReferences", () => {
    it("не-массив и невалидные элементы отбрасываются, валидные остаются", () => {
        expect(parseWireReferences("junk")).toEqual([]);
        expect(
            parseWireReferences([
                null,
                42,
                { uri: "", range: RANGE },
                // uri не строкой — форма чужая, даже когда диапазон валиден.
                { uri: 42, range: RANGE },
                { uri: "file:///b.ts" },
                { uri: "file:///b.ts", range: { startLine: "x" } },
                { uri: "file:///ok.ts", range: RANGE },
            ]),
        ).toEqual([{ uri: "file:///ok.ts", range: RANGE }]);
    });

    it("порядок ссылок сохраняется — панель показывает их в порядке провайдера", () => {
        expect(
            parseWireReferences([
                { uri: "file:///b.ts", range: RANGE },
                { uri: "file:///a.ts", range: RANGE },
            ]).map((ref) => ref.uri),
        ).toEqual(["file:///b.ts", "file:///a.ts"]);
    });
});

describe("wireTypes — wireToCoreReferences", () => {
    it("переводит wire-диапазон в core IRange", () => {
        expect(wireToCoreReferences([{ uri: "file:///ok.ts", range: RANGE }])).toEqual([
            { uri: "file:///ok.ts", range: createRange(7, 4, 7, 9) },
        ]);
    });
});

describe("wireTypes — requestReferences", () => {
    it("успешный ответ парсится в core-ссылки", async () => {
        const result = await requestReferences(
            (method, params) => {
                expect(method).toBe("languages.provideReferences");
                expect(params).toEqual(PARAMS);
                return Promise.resolve([
                    { uri: "file:///defs.ts", range: RANGE },
                    { uri: "file:///use.ts", range: RANGE },
                ]);
            },
            PARAMS,
            1000,
        );
        expect(result).toEqual([
            { uri: "file:///defs.ts", range: createRange(7, 4, 7, 9) },
            { uri: "file:///use.ts", range: createRange(7, 4, 7, 9) },
        ]);
    });

    it("includeDeclaration: false доезжает до субпроцесса как есть", async () => {
        const params = { ...PARAMS, includeDeclaration: false };
        await requestReferences((_method, sent) => {
            expect(sent).toEqual(params);
            return Promise.resolve([]);
        }, params, 1000);
    });

    it("таймаут → пустой результат (панель просто останется пустой)", async () => {
        expect(await requestReferences(() => new Promise(() => undefined), PARAMS, 5)).toEqual([]);
    });

    it("ошибка RPC → пустой результат", async () => {
        expect(await requestReferences(() => Promise.reject(new Error("boom")), PARAMS, 1000)).toEqual([]);
    });

    it("структурно чужой ответ → пустой результат", async () => {
        expect(await requestReferences(() => Promise.resolve({ nope: true }), PARAMS, 1000)).toEqual([]);
    });
});
