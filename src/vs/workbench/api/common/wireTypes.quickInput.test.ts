import { describe, expect, it } from "vitest";

import { parseWireInputBoxResult, parseWireQuickPickEvent, parseWireQuickPickResult } from "./wireTypes.ts";

describe("parseWireInputBoxResult", () => {
    it("a string is the entered value, anything else is cancel", () => {
        expect(parseWireInputBoxResult({ value: "Ada" })).toEqual({ value: "Ada" });
        expect(parseWireInputBoxResult({ value: "" })).toEqual({ value: "" });
        expect(parseWireInputBoxResult({ value: null })).toEqual({ value: null });
        expect(parseWireInputBoxResult({})).toEqual({ value: null });
        expect(parseWireInputBoxResult(null)).toEqual({ value: null });
    });
});

describe("parseWireQuickPickResult", () => {
    it("an array of integers is the selected indices", () => {
        expect(parseWireQuickPickResult({ indices: [0, 2] })).toEqual({ indices: [0, 2] });
        expect(parseWireQuickPickResult({ indices: [] })).toEqual({ indices: [] });
    });

    it("garbage indices are dropped", () => {
        expect(parseWireQuickPickResult({ indices: [0, -1, 1.5, "x", 3] })).toEqual({ indices: [0, 3] });
    });

    it("a missing array is cancel", () => {
        expect(parseWireQuickPickResult({ indices: null })).toEqual({ indices: null });
        expect(parseWireQuickPickResult({})).toEqual({ indices: null });
        expect(parseWireQuickPickResult(null)).toEqual({ indices: null });
    });
});

describe("parseWireQuickPickEvent", () => {
    it("each event kind has its own shape", () => {
        expect(parseWireQuickPickEvent({ handle: 1, kind: "changeValue", value: "go" })).toEqual({
            handle: 1,
            kind: "changeValue",
            value: "go",
        });
        expect(parseWireQuickPickEvent({ handle: 1, kind: "accept", value: "extra" })).toEqual({
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

    it("a foreign shape is null", () => {
        expect(parseWireQuickPickEvent(null)).toBeNull();
        expect(parseWireQuickPickEvent({ kind: "accept" })).toBeNull();
        expect(parseWireQuickPickEvent({ handle: 1, kind: "explode" })).toBeNull();
        expect(parseWireQuickPickEvent({ handle: 1, kind: "changeValue" })).toBeNull();
        expect(parseWireQuickPickEvent({ handle: 1, kind: "changeActive" })).toBeNull();
    });
});
