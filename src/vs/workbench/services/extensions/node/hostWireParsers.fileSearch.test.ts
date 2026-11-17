import { describe, expect, it } from "vitest";

import { parseWireFileIndexResult, parseWireFileQueryResult } from "./hostWireParsers.ts";

describe("parseWireFileIndexResult", () => {
    it("reads limitHit, anything but true is false", () => {
        expect(parseWireFileIndexResult({ limitHit: true })).toEqual({ limitHit: true });
        expect(parseWireFileIndexResult({ limitHit: "yes" })).toEqual({ limitHit: false });
        expect(parseWireFileIndexResult({})).toEqual({ limitHit: false });
    });

    it.each([null, 1, "x"])("throws on a non-object %j", (raw) => {
        expect(() => parseWireFileIndexResult(raw)).toThrow("search.fileIndex");
    });
});

describe("parseWireFileQueryResult", () => {
    it("takes a well-formed result as is", () => {
        const raw = {
            matches: [{ relativePath: "src/a.ts", score: 3, matchedIndices: [0, 4] }],
            complete: true,
            limitHit: true,
        };
        expect(parseWireFileQueryResult(raw)).toEqual(raw);
    });

    it("flags are true only when exactly true", () => {
        expect(parseWireFileQueryResult({ matches: [], complete: 1, limitHit: "true" })).toEqual({
            matches: [],
            complete: false,
            limitHit: false,
        });
    });

    it("drops a malformed match and keeps the rest; non-numeric indices are filtered", () => {
        const result = parseWireFileQueryResult({
            matches: [
                null,
                { relativePath: 1, score: 1, matchedIndices: [] },
                { relativePath: "a", score: Number.NaN, matchedIndices: [] },
                { relativePath: "b", score: 1, matchedIndices: "0" },
                { relativePath: "ok.ts", score: 2, matchedIndices: [0, "1", 2] },
            ],
        });
        expect(result.matches).toEqual([{ relativePath: "ok.ts", score: 2, matchedIndices: [0, 2] }]);
    });

    it.each([null, undefined, 1, "x", {}, { matches: {} }])("throws without a matches array: %j", (raw) => {
        expect(() => parseWireFileQueryResult(raw)).toThrow("search.fileQuery: the result must carry a matches array");
    });
});
