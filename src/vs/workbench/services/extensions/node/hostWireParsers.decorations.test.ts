import { describe, expect, it } from "vitest";

import { parseDecorationRanges, parseWireFileDecorations, themeColorIdOf } from "./hostWireParsers.ts";

describe("hostWireParsers — decorations serialization (Chunk 4)", () => {
    describe("themeColorIdOf", () => {
        it("extracts the id from { $themeColor }", () => {
            expect(themeColorIdOf({ $themeColor: "x" })).toBe("x");
        });
        it("CSS string / undefined → undefined", () => {
            expect(themeColorIdOf("#fff")).toBeUndefined();
            expect(themeColorIdOf(undefined)).toBeUndefined();
        });
        it("non-string $themeColor → undefined (not the value as is)", () => {
            expect(themeColorIdOf({ $themeColor: 5 } as unknown as { $themeColor: string })).toBeUndefined();
        });
    });

    describe("parseDecorationRanges", () => {
        it("valid nested ranges → IRange[]", () => {
            expect(
                parseDecorationRanges([{ start: { line: 1, character: 2 }, end: { line: 3, character: 4 } }]),
            ).toEqual([{ start: { line: 1, character: 2 }, end: { line: 3, character: 4 } }]);
        });
        it("invalid elements are dropped (drop+skip)", () => {
            expect(
                parseDecorationRanges([
                    { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
                    { start: { line: 0 } },
                    "nope",
                    null,
                ]),
            ).toHaveLength(1);
        });
        it("non-array → []", () => {
            expect(parseDecorationRanges(undefined)).toEqual([]);
        });
    });

    describe("parseWireFileDecorations", () => {
        it("parses uri + optional fields; a bare uri (removal) is kept", () => {
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
        it("non-array → []", () => {
            expect(parseWireFileDecorations(null)).toEqual([]);
        });
        it("a function with uri is not a decoration and is dropped", () => {
            expect(parseWireFileDecorations([Object.assign(() => undefined, { uri: "file:///a" })])).toEqual([]);
        });
        it("malformed and missing optional fields leave no key at all", () => {
            expect(
                parseWireFileDecorations([
                    { uri: "file:///a", badge: 5, colorId: 5, propagate: "yes" },
                    { uri: "file:///b" },
                ]),
            ).toStrictEqual([{ uri: "file:///a" }, { uri: "file:///b" }]);
        });
    });
});
