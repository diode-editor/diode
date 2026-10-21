import { describe, expect, it } from "vitest";

import { createRange } from "../core/iRange.ts";
import type { ISelection } from "../core/iSelection.ts";
import { createCursorSelection, createSelection } from "../core/iSelection.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";
import { compareTextEditsInDocumentOrder, createTextEdit } from "../core/iTextEdit.ts";
import { TextDocument } from "../model/textDocument.ts";

import { planTrackedSelections, resolveTrackedSelections } from "./trackedSelections.ts";

/** Plan on the source text → apply → selections via inverse edits, as in `EditorViewState.applyEdits`. */
function track(text: string, edits: ITextEdit[], selections: ISelection[]): { text: string; selections: ISelection[] } {
    const doc = new TextDocument(text);
    const sorted = [...edits].sort(compareTextEditsInDocumentOrder);
    const plan = planTrackedSelections(doc, sorted, selections);
    const { inverseEdits } = doc.applyEdits(edits);
    return { text: doc.getText(), selections: resolveTrackedSelections(plan, sorted, inverseEdits) };
}

const caret = (line: number, character: number): ISelection => createCursorSelection(line, character);
const insert = (line: number, character: number, text: string): ITextEdit =>
    createTextEdit(createRange(line, character, line, character), text);
const replace = (sl: number, sc: number, el: number, ec: number, text: string): ITextEdit =>
    createTextEdit(createRange(sl, sc, el, ec), text);

function flat(selections: readonly ISelection[]): number[][] {
    return selections.map((s) => [s.anchor.line, s.anchor.character, s.active.line, s.active.character]);
}

describe("trackedSelections: cursors shift following edits (upstream markers)", () => {
    it("an edit below the cursor leaves it untouched", () => {
        const result = track("abc\ndef", [replace(1, 1, 1, 2, "X")], [caret(0, 2)]);
        expect(result.text).toBe("abc\ndXf");
        expect(flat(result.selections)).toEqual([[0, 2, 0, 2]]);
    });

    it("inserting lines above moves the cursor down by their count, same column", () => {
        const result = track("a\nfoo", [insert(0, 0, "x\ny\n")], [caret(1, 2)]);
        expect(result.text).toBe("x\ny\na\nfoo");
        expect(flat(result.selections)).toEqual([[3, 2, 3, 2]]);
    });

    it("an edit to the left on the same line shifts the column by the length difference", () => {
        const result = track("abcdef", [replace(0, 1, 0, 3, "XYZW")], [caret(0, 5)]);
        expect(result.text).toBe("aXYZWdef");
        expect(flat(result.selections)).toEqual([[0, 7, 0, 7]]);
    });

    it("insertion exactly at the cursor: the cursor goes to the end of the insertion, selecting nothing", () => {
        const result = track("ab", [insert(0, 1, "XY")], [caret(0, 1)]);
        expect(result.text).toBe("aXYb");
        expect(flat(result.selections)).toEqual([[0, 3, 0, 3]]);
    });

    it("a deletion starting at the cursor does not move it", () => {
        const result = track("abcd", [replace(0, 1, 0, 3, "")], [caret(0, 1)]);
        expect(result.text).toBe("ad");
        expect(flat(result.selections)).toEqual([[0, 1, 0, 1]]);
    });

    it("a cursor inside a deletion and at its end goes to the deletion start (trim trailing whitespace)", () => {
        const result = track(
            "ab   \ncd  ",
            [replace(0, 2, 0, 5, ""), replace(1, 2, 1, 4, "")],
            [caret(0, 3), caret(1, 4)],
        );
        expect(result.text).toBe("ab\ncd");
        expect(flat(result.selections)).toEqual([
            [0, 2, 0, 2],
            [1, 2, 1, 2],
        ]);
    });

    it("a cursor in the common part of a replacement keeps its offset, deeper it goes to the insertion end", () => {
        // Replace "bcde" with "XY": the common part is 2 characters.
        const result = track("abcdef", [replace(0, 1, 0, 5, "XY")], [caret(0, 2), caret(0, 3), caret(0, 4)]);
        expect(result.text).toBe("aXYf");
        expect(flat(result.selections)).toEqual([
            [0, 2, 0, 2],
            [0, 3, 0, 3],
            [0, 3, 0, 3],
        ]);
    });

    it("an offset inside a multi-line insertion is computed by its lines", () => {
        // "bc" → "X\nYZ": the cursor after "b" keeps offset 1 (after "X"),
        // after "c" (end of the replaced text, the insertion is longer) it moves to the end of the insertion.
        const result = track("abcd", [replace(0, 1, 0, 3, "X\nYZ")], [caret(0, 2), caret(0, 3)]);
        expect(result.text).toBe("aX\nYZd");
        expect(flat(result.selections)).toEqual([
            [0, 2, 0, 2],
            [1, 2, 1, 2],
        ]);
    });

    it("an offset inside multi-line replaced text is measured by the original text", () => {
        // "b\ncd" (4 characters) → "WXYZ": the cursor after "c" is offset 3.
        const result = track("ab\ncde", [replace(0, 1, 1, 2, "WXYZ")], [caret(1, 1)]);
        expect(result.text).toBe("aWXYZe");
        expect(flat(result.selections)).toEqual([[0, 4, 0, 4]]);
    });

    it("a cursor at the boundary of a replacement longer than the replaced text goes to the insertion end", () => {
        // "bc" → "XYZ": the marker at the end of the replaced text is at the end of the common part;
        // a selection end doesn't stick left, so it moves on.
        const result = track("abcd", [replace(0, 1, 0, 3, "XYZ")], [caret(0, 3)]);
        expect(result.text).toBe("aXYZd");
        expect(flat(result.selections)).toEqual([[0, 4, 0, 4]]);
    });

    it("a cursor at the boundary of a replacement shorter than the replaced text stays at the end of the common part", () => {
        // "bcd" → "XY": the deletion is longer than the insertion — a marker at the end of the common part stays.
        const result = track("abcde", [replace(0, 1, 0, 4, "XY")], [caret(0, 3)]);
        expect(result.text).toBe("aXYe");
        expect(flat(result.selections)).toEqual([[0, 3, 0, 3]]);
    });

    it("a selection start at the common part boundary sticks left and stays", () => {
        // "bc" → "XYZ": the start at the end of "bc" (common part 2) stays after "XY".
        const result = track("abcde", [replace(0, 1, 0, 3, "XYZ")], [createSelection(0, 3, 0, 4)]);
        expect(result.text).toBe("aXYZde");
        expect(flat(result.selections)).toEqual([[0, 3, 0, 5]]);
    });

    it("a selection grows when an insertion lands on its edges", () => {
        const result = track("abcd", [insert(0, 1, "<"), insert(0, 3, ">")], [createSelection(0, 1, 0, 3)]);
        expect(result.text).toBe("a<bc>d");
        expect(flat(result.selections)).toEqual([[0, 1, 0, 5]]);
    });

    it("selection direction is preserved", () => {
        const result = track("abcd", [insert(0, 0, "xx")], [createSelection(0, 3, 0, 1)]);
        expect(result.text).toBe("xxabcd");
        expect(flat(result.selections)).toEqual([[0, 5, 0, 3]]);
    });

    it("a reversed selection sticks left at its start — active, not anchor", () => {
        // Inserting at the right edge (anchor) grows the selection, at the left edge (active) it doesn't.
        const result = track("abcdef", [insert(0, 1, "<"), insert(0, 4, ">")], [createSelection(0, 4, 0, 1)]);
        expect(result.text).toBe("a<bcd>ef");
        expect(flat(result.selections)).toEqual([[0, 6, 0, 1]]);
    });

    it("an edit on a line below zero shifts cursor lines by its line delta", () => {
        const result = track("a\nb\nc\nd", [insert(1, 0, "X\nY\n")], [caret(3, 1)]);
        expect(result.text).toBe("a\nX\nY\nb\nc\nd");
        expect(flat(result.selections)).toEqual([[5, 1, 5, 1]]);
    });

    it("replacement next to a deletion: the selection start stays in the common part of the replacement", () => {
        // "ab" → "abXY" and an adjacent deletion of "cd": the deletion doesn't move the start, the replace decides.
        const edits = [replace(0, 0, 0, 2, "abXY"), replace(0, 2, 0, 4, "")];
        const result = track("abcdefgh", edits, [createSelection(0, 2, 0, 6)]);
        expect(result.text).toBe("abXYefgh");
        expect(flat(result.selections)).toEqual([[0, 2, 0, 6]]);
    });

    it("deletion next to an insertion: the cursor goes after the insertion, the selection start before it", () => {
        // Delete "bc" and insert "XY" at its end point.
        const edits = [replace(0, 1, 0, 3, ""), insert(0, 3, "XY")];
        const result = track("abcd", edits, [caret(0, 3), createSelection(0, 3, 0, 4)]);
        expect(result.text).toBe("aXYd");
        expect(flat(result.selections)).toEqual([
            [0, 3, 0, 3],
            [0, 1, 0, 4],
        ]);
    });

    it("adjacent to an empty edit earlier in order: the marker goes to the lower one", () => {
        // Inserting an empty string at the end of "bc" doesn't move the marker — the deletion decides.
        const edits = [replace(0, 1, 0, 3, ""), insert(0, 3, "")];
        const result = track("abcd", edits, [caret(0, 3)]);
        expect(result.text).toBe("ad");
        expect(flat(result.selections)).toEqual([[0, 1, 0, 1]]);
    });
});
