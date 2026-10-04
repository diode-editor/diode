import { describe, expect, it } from "vitest";

import { parseDecorationRanges, parseWireFileDecorations, themeColorIdOf } from "./wireTypes.ts";

describe("WireTypes — decorations serialization (Chunk 4)", () => {
    describe("themeColorIdOf", () => {
        it("извлекает id из { $themeColor }", () => {
            expect(themeColorIdOf({ $themeColor: "x" })).toBe("x");
        });
        it("CSS-строка / undefined → undefined", () => {
            expect(themeColorIdOf("#fff")).toBeUndefined();
            expect(themeColorIdOf(undefined)).toBeUndefined();
        });
    });

    describe("parseDecorationRanges", () => {
        it("валидные nested-ranges → IRange[]", () => {
            expect(
                parseDecorationRanges([{ start: { line: 1, character: 2 }, end: { line: 3, character: 4 } }]),
            ).toEqual([{ start: { line: 1, character: 2 }, end: { line: 3, character: 4 } }]);
        });
        it("невалидные элементы отбрасываются (drop+skip)", () => {
            expect(
                parseDecorationRanges([
                    { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
                    { start: { line: 0 } },
                    "nope",
                    null,
                ]),
            ).toHaveLength(1);
        });
        it("не-массив → []", () => {
            expect(parseDecorationRanges(undefined)).toEqual([]);
        });
    });

    describe("parseWireFileDecorations", () => {
        it("парсит uri + опциональные поля; голый uri (снятие) сохраняется", () => {
            expect(
                parseWireFileDecorations([
                    { uri: "file:///a", badge: "M", colorId: "c", propagate: true },
                    { uri: "file:///b" },
                    { uri: "", badge: "X" },
                    { badge: "no-uri" },
                    null,
                    "junk",
                ]),
            ).toEqual([{ uri: "file:///a", badge: "M", colorId: "c", propagate: true }, { uri: "file:///b" }]);
        });
        it("не-массив → []", () => {
            expect(parseWireFileDecorations(null)).toEqual([]);
        });
    });
});
