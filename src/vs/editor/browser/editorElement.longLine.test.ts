import { describe, expect, it } from "vitest";

import { Point, Size } from "../../../../tuidom/common/geometryPromitives.ts";
import { STOP_RENDERING_LINE_AFTER } from "../../../../tuidom/common/textLimits.ts";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

const TRUNCATION_MARKER = "…";

function createEditor(text: string, width = 40, height = 3): { app: TestApp; editor: EditorElement; vs: EditorViewState } {
    const doc = new TextDocument(text);
    const vs = new EditorViewState(doc);
    const editor = new EditorElement(vs);
    const app = TestApp.createWithContent(editor, new Size(width, height));
    return { app, editor, vs };
}

describe("EditorElement — long-line truncation marker", () => {
    it("draws the overflow ellipsis at the cut point when it is on screen", () => {
        // One line a bit longer than the render cap → rendering stops at the cap
        // and the cut point sits at display column STOP_RENDERING_LINE_AFTER.
        const { app, editor, vs } = createEditor("x".repeat(STOP_RENDERING_LINE_AFTER + 50), 40, 3);
        const gw = editor.gutterWidth;
        const contentCols = 40 - gw;

        // Scroll so the cut column lands a few columns into the viewport.
        const markerScreenCol = 10;
        vs.scrollLeft = STOP_RENDERING_LINE_AFTER - markerScreenCol;
        app.render();

        const backend = app.backend;
        // Columns before the cut still show real content ('x').
        expect(backend.getTextAt(new Point(gw + markerScreenCol - 1, 0), 1)).toBe("x");
        // The cut point shows the overflow marker.
        expect(backend.getTextAt(new Point(gw + markerScreenCol, 0), 1)).toBe(TRUNCATION_MARKER);
        // Past the cut is blank (nothing beyond the cap is rendered).
        expect(backend.getTextAt(new Point(gw + markerScreenCol + 1, 0), 1)).toBe(" ");
        // Marker stays inside the content area.
        expect(markerScreenCol).toBeLessThan(contentCols);
    });

    it("shows no marker when the cut point is scrolled off to the right", () => {
        const { app, editor, vs } = createEditor("y".repeat(STOP_RENDERING_LINE_AFTER + 50), 40, 3);
        const gw = editor.gutterWidth;
        vs.scrollLeft = 0; // viewport shows the head; cut point is far to the right
        app.render();

        const backend = app.backend;
        const row = backend.getTextAt(new Point(gw, 0), 40 - gw);
        expect(row).not.toContain(TRUNCATION_MARKER);
    });

    it("draws no marker for a line at or below the cap", () => {
        const { app, editor, vs } = createEditor("z".repeat(STOP_RENDERING_LINE_AFTER), 40, 3);
        const gw = editor.gutterWidth;
        // Scroll to the very end of the (non-truncated) line.
        vs.scrollLeft = STOP_RENDERING_LINE_AFTER - 10;
        app.render();

        const backend = app.backend;
        const row = backend.getTextAt(new Point(gw, 0), 40 - gw);
        expect(row).not.toContain(TRUNCATION_MARKER);
    });
});
