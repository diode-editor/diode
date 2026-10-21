import { describe, expect, it } from "vitest";

import { parseWireClipboardText, parseWireOpenExternalResult, parseWireShowMessageResult } from "./wireTypes.ts";

describe("parseWireShowMessageResult", () => {
    it("an index passes through as is", () => {
        expect(parseWireShowMessageResult({ index: 2 })).toEqual({ index: 2 });
        expect(parseWireShowMessageResult({ index: 0 })).toEqual({ index: 0 });
    });

    it("null, garbage and a negative index mean closed without a choice", () => {
        expect(parseWireShowMessageResult({ index: null })).toEqual({ index: null });
        expect(parseWireShowMessageResult({ index: "1" })).toEqual({ index: null });
        expect(parseWireShowMessageResult({ index: 1.5 })).toEqual({ index: null });
        expect(parseWireShowMessageResult({ index: -1 })).toEqual({ index: null });
        expect(parseWireShowMessageResult(null)).toEqual({ index: null });
    });
});

describe("parseWireClipboardText", () => {
    it("a string passes through as is", () => {
        expect(parseWireClipboardText({ text: "copied" })).toEqual({ text: "copied" });
    });

    it("garbage gives an empty buffer", () => {
        expect(parseWireClipboardText({ text: 7 })).toEqual({ text: "" });
        expect(parseWireClipboardText(null)).toEqual({ text: "" });
    });
});

describe("parseWireOpenExternalResult", () => {
    it("true only for a strict flag", () => {
        expect(parseWireOpenExternalResult({ opened: true })).toBe(true);
        expect(parseWireOpenExternalResult({ opened: "yes" })).toBe(false);
        expect(parseWireOpenExternalResult({})).toBe(false);
        expect(parseWireOpenExternalResult(null)).toBe(false);
    });
});
