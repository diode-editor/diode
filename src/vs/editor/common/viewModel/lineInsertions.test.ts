import { describe, expect, it } from "vitest";

import type { IInlineInsertion } from "../model/iInlineInsertion.ts";
import { TextDocument } from "../model/textDocument.ts";

import {
    composedCaretOffset,
    composedFragmentStart,
    composedLineContent,
    composedOffset,
    documentOffset,
    groupLineInsertions,
    NO_LINE_INSERTIONS,
} from "./lineInsertions.ts";

function group(text: string, insertions: readonly IInlineInsertion[]) {
    return groupLineInsertions(new TextDocument(text), insertions);
}

describe("groupLineInsertions", () => {
    it("sorts each line by offset, ties keep the order given", () => {
        const insertions = group("abcdef\nxyz", [
            { line: 0, offset: 4, text: "C" },
            { line: 1, offset: 1, text: "Z" },
            { line: 0, offset: 2, text: "A" },
            { line: 0, offset: 4, text: "D" },
            { line: 0, offset: 2, text: "B" },
        ]);

        expect([...insertions.keys()].sort()).toEqual([0, 1]);
        expect(insertions.get(0)?.map((insertion) => insertion.text)).toEqual(["A", "B", "C", "D"]);
        expect(insertions.get(1)?.map((insertion) => insertion.text)).toEqual(["Z"]);
    });

    it("clamps a stale offset into its line, keeps the rest of the insertion", () => {
        const insertions = group("abc", [
            { line: 0, offset: 10, text: "X", fg: 7, italic: true },
            { line: 0, offset: -2, text: "Y" },
        ]);

        expect(insertions.get(0)).toEqual([
            { line: 0, offset: 0, text: "Y" },
            { line: 0, offset: 3, text: "X", fg: 7, italic: true },
        ]);
    });

    it("keeps an insertion already within its line as is", () => {
        const insertion: IInlineInsertion = { line: 0, offset: 3, text: "X" };

        expect(group("abc", [insertion]).get(0)?.[0]).toBe(insertion);
    });

    it("drops insertions on missing lines", () => {
        const insertions = group("abc\ndef", [
            { line: -1, offset: 0, text: "X" },
            { line: 2, offset: 0, text: "Y" },
            { line: 1, offset: 0, text: "Z" },
        ]);

        expect([...insertions.keys()]).toEqual([1]);
    });
});

describe("composed line math", () => {
    // "ab|cd|ef" with two insertions at 2 and one at 4: "abXYcdZZef".
    const insertions = group("abcdef\nplain", [
        { line: 0, offset: 2, text: "X" },
        { line: 0, offset: 4, text: "ZZ" },
        { line: 0, offset: 2, text: "Y" },
    ]);

    it("splices every insertion in, other lines stay as they are", () => {
        expect(composedLineContent(insertions, 0, "abcdef")).toBe("abXYcdZZef");
        expect(composedLineContent(insertions, 1, "plain")).toBe("plain");
        expect(composedLineContent(NO_LINE_INSERTIONS, 0, "abcdef")).toBe("abcdef");
    });

    it("an insertion at the line end or start goes there", () => {
        const edges = group("abc", [
            { line: 0, offset: 3, text: "E" },
            { line: 0, offset: 0, text: "S" },
        ]);

        expect(composedLineContent(edges, 0, "abc")).toBe("SabcE");
    });

    it("a character moves right by all insertions at or before it", () => {
        expect([0, 1, 2, 3, 4, 5, 6].map((offset) => composedOffset(insertions, 0, offset))).toEqual([
            0, 1, 4, 5, 8, 9, 10,
        ]);
        expect(composedOffset(insertions, 1, 3)).toBe(3);
    });

    it("an insertion point stays left of the insertions there", () => {
        expect([0, 1, 2, 3, 4, 5, 6].map((offset) => composedCaretOffset(insertions, 0, offset))).toEqual([
            0, 1, 2, 5, 6, 9, 10,
        ]);
        expect(composedCaretOffset(insertions, 1, 3)).toBe(3);
    });

    it("a composed offset inside an insertion maps to its insertion point, the rest back to the document", () => {
        // a b X Y c d Z Z e f
        // 0 1 2 3 4 5 6 7 8 9 10
        expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((offset) => documentOffset(insertions, 0, offset))).toEqual([
            0, 1, 2, 2, 2, 3, 4, 4, 4, 5, 6,
        ]);
        expect(documentOffset(insertions, 1, 3)).toBe(3);
    });

    it("the first fragment starts before a leading insertion, a continuation after the insertions at its start", () => {
        const leading = group("abcdef", [
            { line: 0, offset: 0, text: "<<" },
            { line: 0, offset: 3, text: "|" },
        ]);

        expect(composedFragmentStart(leading, 0, 0)).toBe(0);
        expect(composedFragmentStart(leading, 0, 3)).toBe(6);
        expect(composedFragmentStart(leading, 0, 4)).toBe(7);
    });

    it("composed offsets round-trip to document offsets", () => {
        for (let offset = 0; offset <= 6; offset++) {
            expect(documentOffset(insertions, 0, composedOffset(insertions, 0, offset))).toBe(offset);
            expect(documentOffset(insertions, 0, composedCaretOffset(insertions, 0, offset))).toBe(offset);
        }
    });
});
