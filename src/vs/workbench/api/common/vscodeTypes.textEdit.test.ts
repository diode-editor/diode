import { describe, expect, it } from "vitest";

import { EndOfLine, Position, Range, TextEdit } from "./vscodeTypes.ts";

describe("VscodeTypes — TextEdit", () => {
    it("replace sets range/newText", () => {
        const r = new Range(1, 0, 1, 5);
        const e = TextEdit.replace(r, "hi");
        expect(e.range).toBe(r);
        expect(e.newText).toBe("hi");
        expect(e.newEol).toBeUndefined();
    });

    it("insert is an empty range at the position + newText", () => {
        const e = TextEdit.insert(new Position(2, 3), "x");
        expect(e.range.isEmpty).toBe(true);
        expect(e.range.start.isEqual(new Position(2, 3))).toBe(true);
        expect(e.newText).toBe("x");
    });

    it("delete is a range + empty text", () => {
        const r = new Range(0, 0, 0, 4);
        const e = TextEdit.delete(r);
        expect(e.range).toBe(r);
        expect(e.newText).toBe("");
    });

    it("setEndOfLine is a marker edit with newEol", () => {
        const e = TextEdit.setEndOfLine(EndOfLine.CRLF);
        expect(e.newEol).toBe(EndOfLine.CRLF);
        expect(e.newText).toBe("");
    });
});
