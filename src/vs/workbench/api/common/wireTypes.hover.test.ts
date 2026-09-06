import { describe, expect, it } from "vitest";

import { createRange } from "../../../editor/common/core/iRange.ts";

import { parseWireHovers, requestHover, wireToCoreHovers } from "./wireTypes.ts";

const RANGE = { startLine: 2, startCharacter: 4, endLine: 2, endCharacter: 9 };
const PARAMS = { uri: "file:///a.ts", languageId: "typescript", text: "const a = 1;\n", line: 0, character: 6 };

describe("wireTypes — parseWireHovers", () => {
    it("не-массив и невалидные элементы отбрасываются, валидные остаются", () => {
        expect(parseWireHovers("junk")).toEqual([]);
        expect(
            parseWireHovers([
                null,
                42,
                { contents: "не массив" },
                { contents: [] },
                { contents: [42, ""] }, // после фильтра блоков пусто
                { contents: ["const a: number", 7], range: RANGE },
                { contents: ["без range"] },
            ]),
        ).toEqual([{ contents: ["const a: number"], range: RANGE }, { contents: ["без range"], range: undefined }]);
    });

    it("кривой range валидного hover'а отбрасывается, contents остаются", () => {
        expect(parseWireHovers([{ contents: ["текст"], range: { startLine: "x" } }])).toEqual([
            { contents: ["текст"], range: undefined },
        ]);
    });
});

describe("wireTypes — wireToCoreHovers", () => {
    it("переводит wire-диапазон в core IRange; hover без range остаётся без него", () => {
        expect(
            wireToCoreHovers([
                { contents: ["сигнатура"], range: RANGE },
                { contents: ["документация"] },
            ]),
        ).toEqual([{ contents: ["сигнатура"], range: createRange(2, 4, 2, 9) }, { contents: ["документация"] }]);
    });
});

describe("wireTypes — requestHover", () => {
    it("успешный ответ парсится в core-hover'ы", async () => {
        const result = await requestHover(
            (method, params) => {
                expect(method).toBe("languages.provideHover");
                expect(params).toEqual(PARAMS);
                return Promise.resolve([{ contents: ["const a: number"], range: RANGE }]);
            },
            PARAMS,
            1000,
        );
        expect(result).toEqual([{ contents: ["const a: number"], range: createRange(2, 4, 2, 9) }]);
    });

    it("таймаут → пустой результат (hover не блокирует UI)", async () => {
        const result = await requestHover(() => new Promise(() => undefined), PARAMS, 5);
        expect(result).toEqual([]);
    });

    it("ошибка RPC → пустой результат", async () => {
        const result = await requestHover(() => Promise.reject(new Error("boom")), PARAMS, 1000);
        expect(result).toEqual([]);
    });

    it("структурно чужой ответ → пустой результат", async () => {
        const result = await requestHover(() => Promise.resolve({ nope: true }), PARAMS, 1000);
        expect(result).toEqual([]);
    });
});
