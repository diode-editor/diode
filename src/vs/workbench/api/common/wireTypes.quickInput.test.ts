import { describe, expect, it } from "vitest";

import { parseWireInputBoxResult, parseWireQuickPickEvent, parseWireQuickPickResult } from "./wireTypes.ts";

describe("parseWireInputBoxResult", () => {
    it("строка — введённое значение, всё прочее — отмена", () => {
        expect(parseWireInputBoxResult({ value: "Ада" })).toEqual({ value: "Ада" });
        expect(parseWireInputBoxResult({ value: "" })).toEqual({ value: "" });
        expect(parseWireInputBoxResult({ value: null })).toEqual({ value: null });
        expect(parseWireInputBoxResult({})).toEqual({ value: null });
        expect(parseWireInputBoxResult(null)).toEqual({ value: null });
    });
});

describe("parseWireQuickPickResult", () => {
    it("массив целых — выбранные индексы", () => {
        expect(parseWireQuickPickResult({ indices: [0, 2] })).toEqual({ indices: [0, 2] });
        expect(parseWireQuickPickResult({ indices: [] })).toEqual({ indices: [] });
    });

    it("мусорные индексы выбрасываются", () => {
        expect(parseWireQuickPickResult({ indices: [0, -1, 1.5, "x", 3] })).toEqual({ indices: [0, 3] });
    });

    it("отсутствие массива — отмена", () => {
        expect(parseWireQuickPickResult({ indices: null })).toEqual({ indices: null });
        expect(parseWireQuickPickResult({})).toEqual({ indices: null });
        expect(parseWireQuickPickResult(null)).toEqual({ indices: null });
    });
});

describe("parseWireQuickPickEvent", () => {
    it("каждый вид события — своей формой", () => {
        expect(parseWireQuickPickEvent({ handle: 1, kind: "changeValue", value: "go" })).toEqual({
            handle: 1,
            kind: "changeValue",
            value: "go",
        });
        expect(parseWireQuickPickEvent({ handle: 1, kind: "accept", value: "лишнее" })).toEqual({
            handle: 1,
            kind: "accept",
        });
        expect(parseWireQuickPickEvent({ handle: 1, kind: "hide" })).toEqual({ handle: 1, kind: "hide" });
        expect(parseWireQuickPickEvent({ handle: 1, kind: "changeActive", items: [2, 1.5, "x"] })).toEqual({
            handle: 1,
            kind: "changeActive",
            items: [2],
        });
        expect(parseWireQuickPickEvent({ handle: 1, kind: "changeSelection", items: [] })).toEqual({
            handle: 1,
            kind: "changeSelection",
            items: [],
        });
    });

    it("чужая форма — null", () => {
        expect(parseWireQuickPickEvent(null)).toBeNull();
        expect(parseWireQuickPickEvent({ kind: "accept" })).toBeNull();
        expect(parseWireQuickPickEvent({ handle: 1, kind: "explode" })).toBeNull();
        expect(parseWireQuickPickEvent({ handle: 1, kind: "changeValue" })).toBeNull();
        expect(parseWireQuickPickEvent({ handle: 1, kind: "changeActive" })).toBeNull();
    });
});
