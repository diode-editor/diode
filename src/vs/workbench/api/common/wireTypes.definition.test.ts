import { describe, expect, it, vi } from "vitest";

import { createRange } from "../../../editor/common/core/iRange.ts";

import { type IRequestOptions, TimeoutError } from "./rpcEndpoint.ts";
import { parseWireDefinitionLocations, requestDefinition, wireToCoreDefinitionLocations } from "./wireTypes.ts";

const RANGE = { startLine: 2, startCharacter: 4, endLine: 2, endCharacter: 9 };
const PARAMS = {
    handle: 0,
    uri: "file:///a.ts",
    languageId: "typescript",
    version: 1,
    line: 0,
    character: 6,
};

/**
 * Субпроцесс, который не отвечает, за транспортом, который держит срок, как
 * `RpcEndpoint.request`: по истечении `options.timeoutMs` — `TimeoutError`.
 */
function hanging(method: string, _params: unknown, options: IRequestOptions): Promise<unknown> {
    return new Promise((_resolve, reject) => {
        setTimeout(() => {
            reject(new TimeoutError(method, options.timeoutMs ?? 0));
        }, options.timeoutMs);
    });
}

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
        const request = vi.fn(hanging);
        const result = await requestDefinition(request, PARAMS, 5);
        expect(request).toHaveBeenCalledWith("languages.provideDefinition", PARAMS, { timeoutMs: 5 });
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
