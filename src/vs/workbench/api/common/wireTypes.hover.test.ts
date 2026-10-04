import { describe, expect, it } from "vitest";

import { createRange } from "../../../editor/common/core/iRange.ts";

import { parseWireHover, requestHover, wireToCoreHover } from "./wireTypes.ts";

const RANGE = { startLine: 2, startCharacter: 4, endLine: 2, endCharacter: 9 };
const PARAMS = {
    handle: 3,
    uri: "file:///a.ts",
    languageId: "typescript",
    version: 1,
    line: 0,
    character: 6,
};

describe("wireTypes — parseWireHover", () => {
    it("не-объект и hover без контента отбрасываются", () => {
        expect(parseWireHover("junk")).toBeNull();
        expect(parseWireHover(null)).toBeNull();
        expect(parseWireHover({ contents: "не массив" })).toBeNull();
        expect(parseWireHover({ contents: [] })).toBeNull();
        // После фильтра блоков пусто.
        expect(parseWireHover({ contents: [42, ""] })).toBeNull();
    });

    it("невалидные блоки отбрасываются, валидные остаются", () => {
        expect(parseWireHover({ contents: ["const a: number", 7], range: RANGE })).toEqual({
            contents: ["const a: number"],
            range: RANGE,
        });
        expect(parseWireHover({ contents: ["без range"] })).toEqual({ contents: ["без range"], range: undefined });
    });

    it("кривой range валидного hover'а отбрасывается, contents остаются", () => {
        expect(parseWireHover({ contents: ["текст"], range: { startLine: "x" } })).toEqual({
            contents: ["текст"],
            range: undefined,
        });
    });
});

describe("wireTypes — wireToCoreHover", () => {
    it("переводит wire-диапазон в core IRange; hover без range остаётся без него", () => {
        expect(wireToCoreHover({ contents: ["сигнатура"], range: RANGE })).toEqual({
            contents: ["сигнатура"],
            range: createRange(2, 4, 2, 9),
        });
        expect(wireToCoreHover({ contents: ["документация"] })).toEqual({ contents: ["документация"] });
    });
});

describe("wireTypes — requestHover", () => {
    it("успешный ответ парсится в core-hover", async () => {
        const result = await requestHover(
            (method, params) => {
                expect(method).toBe("languages.provideHover");
                expect(params).toEqual(PARAMS);
                return Promise.resolve({ contents: ["const a: number"], range: RANGE });
            },
            PARAMS,
            1000,
        );
        expect(result).toEqual({ contents: ["const a: number"], range: createRange(2, 4, 2, 9) });
    });

    it("таймаут → нет hover'а (hover не блокирует UI)", async () => {
        const result = await requestHover(() => new Promise(() => undefined), PARAMS, 5);
        expect(result).toBeUndefined();
    });

    it("ошибка RPC → нет hover'а", async () => {
        const result = await requestHover(() => Promise.reject(new Error("boom")), PARAMS, 1000);
        expect(result).toBeUndefined();
    });

    it("структурно чужой ответ и null → нет hover'а", async () => {
        expect(await requestHover(() => Promise.resolve({ nope: true }), PARAMS, 1000)).toBeUndefined();
        expect(await requestHover(() => Promise.resolve(null), PARAMS, 1000)).toBeUndefined();
    });
});
