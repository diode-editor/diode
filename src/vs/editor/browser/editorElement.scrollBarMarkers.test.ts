import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import type { IScrollBarMarker } from "@tuidom/elements/scrollbar/iScrollable";
import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { MarkerSeverity } from "../../platform/markers/common/iMarker.ts";
import { createRange } from "../common/core/iRange.ts";
import { createCursorSelection } from "../common/core/iSelection.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";
import { computeIndentationFolds } from "../contrib/folding/foldingRangeProvider.ts";

import { EditorElement } from "./editorElement.ts";

const ERROR = packRgb(250, 0, 0);
const WARNING = packRgb(250, 200, 0);
const INFO = packRgb(0, 120, 250);
const FIND = packRgb(210, 130, 20);
const WORD = packRgb(160, 160, 160);
const ADDED = packRgb(0x48, 0x7e, 0x02);

function makeEditor(content: string, occurrences = false): EditorElement {
    const editor = new EditorElement(new EditorViewState(new TextDocument(content)));
    editor.occurrenceHighlightEnabled = occurrences;
    editor.setStyleVars({
        "editorOverviewRuler.errorForeground": ERROR,
        "editorOverviewRuler.warningForeground": WARNING,
        "editorOverviewRuler.infoForeground": INFO,
        "editorOverviewRuler.findMatchForeground": FIND,
        "editorOverviewRuler.wordHighlightForeground": WORD,
    });
    return editor;
}

/** Style vars resolve during a render pass, so the editor is mounted before it is asked. */
function markersOf(editor: EditorElement): readonly IScrollBarMarker[] {
    TestApp.createWithContent(editor, new Size(40, 10)).render();
    return editor.getScrollBarMarkers();
}

function lines(count: number): string {
    return Array.from({ length: count }, (_, i) => `line ${i}`).join("\n");
}

describe("EditorElement — scrollbar markers", () => {
    it("is empty when nothing is highlighted", () => {
        expect(markersOf(makeEditor(lines(10)))).toEqual([]);
    });

    it("marks diagnostics by severity and skips hints", () => {
        const editor = makeEditor(lines(10));
        editor.markerDecorations = [
            { range: createRange(1, 0, 1, 2), severity: MarkerSeverity.Error },
            { range: createRange(2, 0, 2, 2), severity: MarkerSeverity.Warning },
            { range: createRange(3, 0, 3, 2), severity: MarkerSeverity.Info },
            { range: createRange(4, 0, 4, 2), severity: MarkerSeverity.Hint },
        ];

        const markers = markersOf(editor);

        expect(markers.map(({ start, end, color }) => ({ start, end, color }))).toEqual([
            { start: 1, end: 2, color: ERROR },
            { start: 2, end: 3, color: WARNING },
            { start: 3, end: 4, color: INFO },
        ]);
        expect(markers[0].priority).toBeGreaterThan(markers[1].priority);
        expect(markers[1].priority).toBeGreaterThan(markers[2].priority);
    });

    it("marks find matches, SCM changes and word occurrences, diagnostics winning over them", () => {
        const editor = makeEditor("foo\nbar\nfoo\nbaz", true);
        editor.viewState.selections = [createCursorSelection(0, 1)];
        editor.viewState.searchMatches = [createRange(3, 0, 3, 3)];
        editor.gutterChangeDecorations = [{ range: createRange(1, 0, 2, 0), color: ADDED }];
        editor.markerDecorations = [{ range: createRange(3, 0, 3, 1), severity: MarkerSeverity.Warning }];

        const markers = markersOf(editor);
        const byColor = (color: number) => markers.filter((m) => m.color === color);

        expect(byColor(WORD).map((m) => m.start)).toEqual([0, 2]);
        expect(byColor(ADDED)).toEqual([expect.objectContaining({ start: 1, end: 3 })]);
        expect(byColor(FIND)).toEqual([expect.objectContaining({ start: 3, end: 4 })]);
        const priority = (color: number) => byColor(color)[0].priority;
        expect(priority(WARNING)).toBeGreaterThan(priority(FIND));
        expect(priority(FIND)).toBeGreaterThan(priority(ADDED));
        expect(priority(ADDED)).toBeGreaterThan(priority(WORD));
    });

    it("puts a mark hidden by a fold on the fold header row", () => {
        const doc = new TextDocument("a:\n  b\n  c\nd\ne");
        const viewState = new EditorViewState(doc);
        viewState.setFoldingRegions(computeIndentationFolds(doc, viewState.tabSize));
        viewState.toggleFold(0);
        const editor = new EditorElement(viewState);
        editor.occurrenceHighlightEnabled = false;
        editor.setStyleVars({ "editorOverviewRuler.errorForeground": ERROR });
        editor.markerDecorations = [
            { range: createRange(2, 0, 2, 1), severity: MarkerSeverity.Error },
            { range: createRange(4, 0, 4, 1), severity: MarkerSeverity.Error },
        ];

        expect(markersOf(editor).map(({ start, end }) => ({ start, end }))).toEqual([
            { start: 0, end: 1 },
            { start: 2, end: 3 },
        ]);
    });

    it("shows up on the editor's scrollbar", () => {
        const editor = makeEditor(lines(100));
        editor.markerDecorations = [{ range: createRange(55, 0, 55, 2), severity: MarkerSeverity.Error }];
        const app = TestApp.createWithContent(new ScrollBarDecorator(editor), new Size(30, 10));
        app.render();

        // 100 rows over 10 cells: row 55 lands in cell 5 of the last column.
        expect(app.backend.getTextAt(new Point(29, 5), 1)).toBe("─");
        expect(app.backend.getFgAt(new Point(29, 5))).toBe(ERROR);

        editor.markerDecorations = [];
        editor.markDirty();
        app.render();
        // The editor's track is flat (no ░ shade), so a cleared mark leaves an empty cell.
        expect(app.backend.getTextAt(new Point(29, 5), 1)).toBe(" ");
    });

    it("fills a block of added lines solid on the scrollbar", () => {
        const editor = makeEditor(lines(100));
        editor.gutterChangeDecorations = [{ range: createRange(40, 0, 69, 0), color: ADDED }];
        const app = TestApp.createWithContent(new ScrollBarDecorator(editor), new Size(30, 10));
        app.render();

        // Rows 40..69 cover cells 4..6 whole: one solid bar, not three thin marks.
        for (const y of [4, 5, 6]) {
            expect(app.backend.getTextAt(new Point(29, y), 1)).toBe(" ");
            expect(app.backend.getBgAt(new Point(29, y))).toBe(ADDED);
        }
    });
});
