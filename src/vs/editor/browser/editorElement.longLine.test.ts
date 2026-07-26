import { describe, expect, it } from "vitest";

import { Point, Size } from "../../../../tuidom/common/geometryPromitives.ts";
import { STOP_RENDERING_LINE_AFTER } from "../../../../tuidom/common/textLimits.ts";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement, unthemedEditorStyles } from "./editorElement.ts";

const TRUNCATION_BADGE = "[…]";

function createEditor(text: string, width = 40, height = 3): { app: TestApp; editor: EditorElement; vs: EditorViewState } {
    const doc = new TextDocument(text);
    const vs = new EditorViewState(doc);
    const editor = new EditorElement(vs);
    const app = TestApp.createWithContent(editor, new Size(width, height));
    return { app, editor, vs };
}

describe("EditorElement — long-line truncation badge", () => {
    it("draws the [truncation] badge at the cut point when it is on screen", () => {
        // One line a bit longer than the render cap → rendering stops at the cap
        // and the cut point sits at display column STOP_RENDERING_LINE_AFTER.
        const { app, editor, vs } = createEditor("x".repeat(STOP_RENDERING_LINE_AFTER + 50), 40, 3);
        const gw = editor.gutterWidth;
        const contentCols = 40 - gw;

        // Scroll so the cut column lands a few columns into the viewport.
        const badgeScreenCol = 10;
        vs.scrollLeft = STOP_RENDERING_LINE_AFTER - badgeScreenCol;
        app.render();

        const backend = app.backend;
        // Columns before the cut still show real content ('x').
        expect(backend.getTextAt(new Point(gw + badgeScreenCol - 1, 0), 1)).toBe("x");
        // The cut point shows the three-cell button badge "[…]".
        expect(backend.getTextAt(new Point(gw + badgeScreenCol, 0), 3)).toBe(TRUNCATION_BADGE);
        // Past the badge is blank (nothing beyond the cap is rendered).
        expect(backend.getTextAt(new Point(gw + badgeScreenCol + 3, 0), 1)).toBe(" ");
        // Badge stays inside the content area.
        expect(badgeScreenCol + TRUNCATION_BADGE.length).toBeLessThan(contentCols);
    });

    it("paints the badge in the warning colour so it reads as an affordance", () => {
        const { app, editor, vs } = createEditor("x".repeat(STOP_RENDERING_LINE_AFTER + 50), 40, 3);
        const gw = editor.gutterWidth;
        const badgeScreenCol = 10;
        vs.scrollLeft = STOP_RENDERING_LINE_AFTER - badgeScreenCol;
        app.render();

        // Untouched by a theme, the editor uses the unthemed style baseline.
        expect(app.backend.getFgAt(new Point(gw + badgeScreenCol, 0))).toBe(unthemedEditorStyles.warningForeground);
    });

    it("shows no badge when the cut point is scrolled off to the right", () => {
        const { app, editor, vs } = createEditor("y".repeat(STOP_RENDERING_LINE_AFTER + 50), 40, 3);
        const gw = editor.gutterWidth;
        vs.scrollLeft = 0; // viewport shows the head; cut point is far to the right
        app.render();

        const row = app.backend.getTextAt(new Point(gw, 0), 40 - gw);
        expect(row).not.toContain("…");
    });

    it("draws no badge for a line at or below the cap", () => {
        const { app, editor, vs } = createEditor("z".repeat(STOP_RENDERING_LINE_AFTER), 40, 3);
        const gw = editor.gutterWidth;
        // Scroll to the very end of the (non-truncated) line.
        vs.scrollLeft = STOP_RENDERING_LINE_AFTER - 10;
        app.render();

        const row = app.backend.getTextAt(new Point(gw, 0), 40 - gw);
        expect(row).not.toContain("…");
    });
});
