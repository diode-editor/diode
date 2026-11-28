import { describe, expect, it } from "vitest";

import {
    parseDecorationOptions,
    parseWireFileDecorationProvider,
    parseWireFileDecorationProviderHandle,
    parseWireFileDecorationReply,
    parseWireFileDecorationsChanged,
    themeColorIdOf,
} from "./hostWireParsers.ts";

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

    describe("parseDecorationOptions", () => {
        const RANGE = { start: { line: 1, character: 2 }, end: { line: 3, character: 4 } };
        it("[api:TextEditor.setDecorations] { range, renderOptions } → IWireDecorationOptions[]", () => {
            const renderOptions = { before: { contentText: "x" } };
            expect(parseDecorationOptions([{ range: RANGE, renderOptions }, { range: RANGE }])).toStrictEqual([
                { range: RANGE, renderOptions },
                { range: RANGE },
            ]);
        });
        it("a non-object renderOptions is dropped, the range lives", () => {
            expect(parseDecorationOptions([{ range: RANGE, renderOptions: "red" }])).toStrictEqual([{ range: RANGE }]);
            expect(parseDecorationOptions([{ range: RANGE, renderOptions: null }])).toStrictEqual([{ range: RANGE }]);
        });
        it("invalid elements are dropped (drop+skip)", () => {
            expect(
                parseDecorationOptions([
                    { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } },
                    { range: { start: { line: 0 } } },
                    // A bare range is not the wire shape.
                    RANGE,
                    "nope",
                    null,
                ]),
            ).toHaveLength(1);
        });
        it("non-array → []", () => {
            expect(parseDecorationOptions(undefined)).toEqual([]);
        });
        it("[api:DecorationOptions.hoverMessage] hoverMessage keeps its strings; empty or not an array has no key", () => {
            const renderOptions = { after: { contentText: "x" } };
            expect(
                parseDecorationOptions([
                    { range: RANGE, hoverMessage: ["a", 1, null, "b"] },
                    { range: RANGE, renderOptions, hoverMessage: ["m"] },
                    { range: RANGE, hoverMessage: [7] },
                    { range: RANGE, hoverMessage: "a" },
                ]),
            ).toStrictEqual([
                { range: RANGE, hoverMessage: ["a", "b"] },
                { range: RANGE, renderOptions, hoverMessage: ["m"] },
                { range: RANGE },
                { range: RANGE },
            ]);
        });
    });

    describe("file decoration providers", () => {
        it("a registration needs a numeric handle and a string extension id", () => {
            expect(parseWireFileDecorationProvider({ handle: 1, extensionId: "e" })).toEqual({
                handle: 1,
                extensionId: "e",
            });
            expect(parseWireFileDecorationProvider({ handle: "1", extensionId: "e" })).toBeNull();
            expect(parseWireFileDecorationProvider({ handle: 1 })).toBeNull();
            expect(parseWireFileDecorationProvider(null)).toBeNull();
        });
        it("a handle is a finite number", () => {
            expect(parseWireFileDecorationProviderHandle({ handle: 0 })).toEqual({ handle: 0 });
            expect(parseWireFileDecorationProviderHandle({ handle: Number.NaN })).toBeNull();
            expect(parseWireFileDecorationProviderHandle(undefined)).toBeNull();
        });
        it("a change: a list keeps its strings, anything else means every resource", () => {
            expect(parseWireFileDecorationsChanged({ handle: 1, uris: ["file:///a", 5, "file:///b"] })).toEqual({
                handle: 1,
                uris: ["file:///a", "file:///b"],
            });
            expect(parseWireFileDecorationsChanged({ handle: 1, uris: null })).toEqual({ handle: 1, uris: null });
            expect(parseWireFileDecorationsChanged({ uris: [] })).toBeNull();
        });
        it("a reply by request id: fields of a foreign type and non-object entries are dropped", () => {
            const reply = parseWireFileDecorationReply({
                1: { propagate: true, tooltip: "t", badge: "M", colorId: "c" },
                2: { propagate: "yes", tooltip: 5, badge: 5, colorId: 5 },
                3: null,
                4: "junk",
            });
            expect([...reply]).toStrictEqual([
                [1, { propagate: true, tooltip: "t", badge: "M", colorId: "c" }],
                [2, {}],
            ]);
            expect(parseWireFileDecorationReply(null).size).toBe(0);
            expect(parseWireFileDecorationReply("junk").size).toBe(0);
        });
    });
});
