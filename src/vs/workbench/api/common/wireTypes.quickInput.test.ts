import { describe, expect, it } from "vitest";

import { parseWireInputBoxResult, parseWireQuickPickResult } from "./wireTypes.ts";

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
