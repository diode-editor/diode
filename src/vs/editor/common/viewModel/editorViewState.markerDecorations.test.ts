import { describe, expect, it, vi } from "vitest";

import { MarkerSeverity } from "../../../platform/markers/common/iMarker.ts";
import { createRange } from "../core/iRange.ts";
import { createTextEdit } from "../core/iTextEdit.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

describe("EditorViewState — marker decorations", () => {
    it("returns markers with severity and a range shifted by an edit", () => {
        const doc = new TextDocument("let bad = 1;");
        const viewState = new EditorViewState(doc);
        viewState.setMarkerDecorations([
            { range: createRange(0, 4, 0, 7), severity: MarkerSeverity.Error },
            { range: createRange(0, 10, 0, 11), severity: MarkerSeverity.Hint },
        ]);
        doc.applyEdits([createTextEdit(createRange(0, 0, 0, 0), "  ")]);
        expect(viewState.getMarkerDecorations()).toEqual([
            { range: createRange(0, 6, 0, 9), severity: MarkerSeverity.Error },
            { range: createRange(0, 12, 0, 13), severity: MarkerSeverity.Hint },
        ]);
    });

    it("an empty range covers the word at it; on a blank line, past the text or off a word it stays empty", () => {
        const doc = new TextDocument("    count = 1;  \n\n   \nx  y\nab  ");
        const viewState = new EditorViewState(doc);
        const empty = (line: number, character: number) => ({
            range: createRange(line, character, line, character),
            severity: MarkerSeverity.Error,
        });
        viewState.setMarkerDecorations([
            empty(0, 4),
            empty(0, 9),
            empty(0, 7),
            empty(0, 14),
            empty(1, 0),
            empty(2, 1),
            empty(3, 1),
            empty(3, 2),
            // Right after the last word, at its last non-whitespace column: upstream keeps it empty.
            empty(4, 2),
        ]);
        expect(viewState.getMarkerDecorations().map((d) => d.range)).toEqual([
            createRange(0, 4, 0, 9),
            createRange(0, 4, 0, 9),
            createRange(0, 4, 0, 9),
            createRange(0, 14, 0, 14),
            createRange(1, 0, 1, 0),
            createRange(2, 1, 2, 1),
            createRange(3, 0, 3, 1),
            createRange(3, 2, 3, 2),
            createRange(4, 2, 4, 2),
        ]);
    });

    it("a range past the text is clamped: a whole-line problem ends at the line end, a line past the end is the last", () => {
        const doc = new TextDocument("let bad = 1;\nok");
        const viewState = new EditorViewState(doc);
        viewState.setMarkerDecorations([
            { range: createRange(0, 0, 0, 2 ** 31 - 2), severity: MarkerSeverity.Warning },
            { range: createRange(-1, -1, 9, 99), severity: MarkerSeverity.Error },
            { range: createRange(7, 1, 7, 1), severity: MarkerSeverity.Info },
        ]);
        expect(viewState.getMarkerDecorations().map((d) => d.range)).toEqual([
            createRange(0, 0, 0, 12),
            createRange(0, 0, 1, 2),
            createRange(1, 0, 1, 2),
        ]);
    });

    it("a new set replaces the previous one instead of adding to it", () => {
        const doc = new TextDocument("let bad = 1;");
        const viewState = new EditorViewState(doc);
        viewState.setMarkerDecorations([{ range: createRange(0, 4, 0, 7), severity: MarkerSeverity.Error }]);
        viewState.setMarkerDecorations([{ range: createRange(0, 0, 0, 3), severity: MarkerSeverity.Warning }]);
        expect(viewState.getMarkerDecorations()).toEqual([
            { range: createRange(0, 0, 0, 3), severity: MarkerSeverity.Warning },
        ]);
    });

    it("a new set removes previous decorations from the document instead of accumulating them", () => {
        const doc = new TextDocument("let bad = 1;");
        const viewState = new EditorViewState(doc);
        const delta = vi.spyOn(doc, "deltaDecorations");
        viewState.setMarkerDecorations([{ range: createRange(0, 4, 0, 7), severity: MarkerSeverity.Error }]);
        const [firstIds] = delta.mock.results.map((result) => result.value as string[]);
        viewState.setMarkerDecorations([]);
        expect(delta.mock.calls[1][0]).toEqual(firstIds);
        expect(firstIds.map((id) => doc.getDecorationRange(id))).toEqual([null]);
    });

    it("two views of one document keep their own markers; dispose removes only its own", () => {
        const doc = new TextDocument("let bad = 1;");
        const left = new EditorViewState(doc);
        const right = new EditorViewState(doc);
        left.setMarkerDecorations([{ range: createRange(0, 4, 0, 7), severity: MarkerSeverity.Error }]);
        right.setMarkerDecorations([{ range: createRange(0, 0, 0, 3), severity: MarkerSeverity.Warning }]);
        left.dispose();

        expect(left.getMarkerDecorations()).toEqual([]);
        expect(right.getMarkerDecorations()).toEqual([
            { range: createRange(0, 0, 0, 3), severity: MarkerSeverity.Warning },
        ]);
    });
});
