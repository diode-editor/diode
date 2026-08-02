import { describe, expect, it } from "vitest";

import { createRange } from "../../../editor/common/core/iRange.ts";

import { parseWireDefinitionLocations, requestDefinition, wireToCoreDefinitionLocations } from "./wireTypes.ts";

const RANGE = { startLine: 2, startCharacter: 4, endLine: 2, endCharacter: 9 };
const PARAMS = { uri: "file:///a.ts", languageId: "typescript", text: "const a = 1;\n", line: 0, character: 6 };

describe("wireTypes — parseWireDefinitionLocations", () => {
    it("не-массив и невалидные элементы отбрасываются, валидные остаются", () => {
        expect(parseWireDefinitionLocations("junk")).toEqual([]);
        expect(
            parseWireDefinitionLocations([
                null,
                42,
                { uri: "", range: RANGE },
                { uri: "file:///b.ts" },
                { uri: "file:///b.ts", range: { startLine: "x" } },
                { uri: "file:///ok.ts", range: RANGE },
            ]),
        ).toEqual([{ uri: "file:///ok.ts", range: RANGE }]);
    });
});

describe("wireTypes — wireToCoreDefinitionLocations", () => {
    it("переводит wire-диапазон в core IRange", () => {
        expect(wireToCoreDefinitionLocations([{ uri: "file:///ok.ts", range: RANGE }])).toEqual([
            { uri: "file:///ok.ts", range: createRange(2, 4, 2, 9) },
        ]);
    });
});

describe("wireTypes — requestDefinition", () => {
    it("успешный ответ парсится в core-цели", async () => {
        const result = await requestDefinition(
            (method, params) => {
                expect(method).toBe("languages.provideDefinition");
                expect(params).toEqual(PARAMS);
                return Promise.resolve([{ uri: "file:///defs.ts", range: RANGE }]);
            },
            PARAMS,
            1000,
        );
        expect(result).toEqual([{ uri: "file:///defs.ts", range: createRange(2, 4, 2, 9) }]);
    });

    it("таймаут → пустой результат (go-to-definition не блокирует UI)", async () => {
        const result = await requestDefinition(() => new Promise(() => undefined), PARAMS, 5);
        expect(result).toEqual([]);
    });

    it("ошибка RPC → пустой результат", async () => {
        const result = await requestDefinition(() => Promise.reject(new Error("boom")), PARAMS, 1000);
        expect(result).toEqual([]);
    });

    it("структурно чужой ответ → пустой результат", async () => {
        const result = await requestDefinition(() => Promise.resolve({ nope: true }), PARAMS, 1000);
        expect(result).toEqual([]);
    });
});
