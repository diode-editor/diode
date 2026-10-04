import { describe, expect, it } from "vitest";

import { parseWireClipboardText, parseWireOpenExternalResult, parseWireShowMessageResult } from "./wireTypes.ts";

describe("parseWireShowMessageResult", () => {
    it("индекс проходит как есть", () => {
        expect(parseWireShowMessageResult({ index: 2 })).toEqual({ index: 2 });
        expect(parseWireShowMessageResult({ index: 0 })).toEqual({ index: 0 });
    });

    it("null, мусор и отрицательный индекс — закрыто без выбора", () => {
        expect(parseWireShowMessageResult({ index: null })).toEqual({ index: null });
        expect(parseWireShowMessageResult({ index: "1" })).toEqual({ index: null });
        expect(parseWireShowMessageResult({ index: 1.5 })).toEqual({ index: null });
        expect(parseWireShowMessageResult({ index: -1 })).toEqual({ index: null });
        expect(parseWireShowMessageResult(null)).toEqual({ index: null });
    });
});

describe("parseWireClipboardText", () => {
    it("строка проходит как есть", () => {
        expect(parseWireClipboardText({ text: "copied" })).toEqual({ text: "copied" });
    });

    it("мусор — пустой буфер", () => {
        expect(parseWireClipboardText({ text: 7 })).toEqual({ text: "" });
        expect(parseWireClipboardText(null)).toEqual({ text: "" });
    });
});

describe("parseWireOpenExternalResult", () => {
    it("true только по строгому флагу", () => {
        expect(parseWireOpenExternalResult({ opened: true })).toBe(true);
        expect(parseWireOpenExternalResult({ opened: "yes" })).toBe(false);
        expect(parseWireOpenExternalResult({})).toBe(false);
        expect(parseWireOpenExternalResult(null)).toBe(false);
    });
});
