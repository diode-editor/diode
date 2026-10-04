import { describe, expect, it } from "vitest";

import {
    parseDecorationRanges,
    parseWireFileDecorations,
    serializeColor,
    serializeDecorationRenderOptions,
    themeColorIdOf,
} from "./wireTypes.ts";

describe("WireTypes — decorations serialization (Chunk 4)", () => {
    describe("serializeColor", () => {
        it("CSS-строка проходит как есть", () => {
            expect(serializeColor("#ff0000")).toBe("#ff0000");
        });
        it("ThemeColor (утиный тип с id) → { $themeColor }", () => {
            expect(serializeColor({ id: "editorGutter.modifiedBackground" })).toEqual({
                $themeColor: "editorGutter.modifiedBackground",
            });
        });
        it("undefined / прочее → undefined", () => {
            expect(serializeColor(undefined)).toBeUndefined();
            expect(serializeColor(42)).toBeUndefined();
            expect(serializeColor({ nope: 1 })).toBeUndefined();
        });
    });

    describe("themeColorIdOf", () => {
        it("извлекает id из { $themeColor }", () => {
            expect(themeColorIdOf({ $themeColor: "x" })).toBe("x");
        });
        it("CSS-строка / undefined → undefined", () => {
            expect(themeColorIdOf("#fff")).toBeUndefined();
            expect(themeColorIdOf(undefined)).toBeUndefined();
        });
    });

    describe("serializeDecorationRenderOptions", () => {
        it("несёт только релевантные поля, ThemeColor сериализуется", () => {
            expect(
                serializeDecorationRenderOptions({
                    isWholeLine: true,
                    overviewRulerLane: 1,
                    overviewRulerColor: { id: "editorGutter.addedBackground" },
                    backgroundColor: "#111",
                    color: { id: "foreground" },
                    gutterIconPath: "/ignored.png",
                    borderWidth: "2px",
                }),
            ).toEqual({
                isWholeLine: true,
                overviewRulerLane: 1,
                overviewRulerColor: { $themeColor: "editorGutter.addedBackground" },
                backgroundColor: "#111",
                color: { $themeColor: "foreground" },
            });
        });
        it("пустые/невалидные опции → пустой объект", () => {
            expect(serializeDecorationRenderOptions(undefined)).toEqual({});
            expect(serializeDecorationRenderOptions(null)).toEqual({});
            expect(serializeDecorationRenderOptions({ isWholeLine: "yes" })).toEqual({});
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
