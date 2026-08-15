import { describe, expect, it } from "vitest";

import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { STYLE_TOKEN_DEFAULTS } from "@tuidom/core/dom/styles/styleTokens";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";
import {
    LONG_LINE_TRUNCATION_BADGE,
    LONG_LINE_TRUNCATION_BADGE_WIDTH,
    STOP_RENDERING_LINE_AFTER,
} from "../common/viewModel/longLineRendering.ts";

import { EditorElement } from "./editorElement.ts";

const BADGE_LABEL = LONG_LINE_TRUNCATION_BADGE.trim(); // "Long line trimmed"

function createEditor(
    text: string,
    width = 60,
    height = 3,
): { app: TestApp; editor: EditorElement; vs: EditorViewState } {
    const doc = new TextDocument(text);
    const vs = new EditorViewState(doc);
    const editor = new EditorElement(vs);
    const app = TestApp.createWithContent(editor, new Size(width, height));
    return { app, editor, vs };
}

describe("EditorElement — long-line truncation button", () => {
    it("draws the 'Long line trimmed' button at the cut point when on screen", () => {
        const { app, editor, vs } = createEditor("x".repeat(STOP_RENDERING_LINE_AFTER + 500), 60, 3);
        const gw = editor.gutterWidth;
        const contentCols = 60 - gw;

        // Scroll so the whole button lands inside the content area.
        const buttonScreenCol = 5;
        vs.scrollLeft = STOP_RENDERING_LINE_AFTER - buttonScreenCol;
        app.render();

        const backend = app.backend;
        // The button's full label is rendered at the cut point.
        expect(backend.getTextAt(new Point(gw + buttonScreenCol, 0), LONG_LINE_TRUNCATION_BADGE_WIDTH)).toBe(
            LONG_LINE_TRUNCATION_BADGE,
        );
        // Whole button fits inside the content area.
        expect(buttonScreenCol + LONG_LINE_TRUNCATION_BADGE_WIDTH).toBeLessThanOrEqual(contentCols);
    });

    it("paints the button as a warning plaque (warning background)", () => {
        const { app, editor, vs } = createEditor("x".repeat(STOP_RENDERING_LINE_AFTER + 500), 60, 3);
        const gw = editor.gutterWidth;
        const buttonScreenCol = 5;
        vs.scrollLeft = STOP_RENDERING_LINE_AFTER - buttonScreenCol;
        app.render();

        // A cell inside the label carries the warning colour as its background.
        const labelCell = new Point(gw + buttonScreenCol + 1, 0);
        expect(app.backend.getBgAt(labelCell)).toBe(STYLE_TOKEN_DEFAULTS["editorWarning.foreground"]);
    });

    it("shows no button when the cut point is scrolled off to the right", () => {
        const { app, editor, vs } = createEditor("y".repeat(STOP_RENDERING_LINE_AFTER + 500), 60, 3);
        const gw = editor.gutterWidth;
        vs.scrollLeft = 0; // viewport shows the head; cut point is far to the right
        app.render();

        const row = app.backend.getTextAt(new Point(gw, 0), 60 - gw);
        expect(row).not.toContain(BADGE_LABEL);
    });

    it("draws no button for a line at or below the cap", () => {
        const { app, editor, vs } = createEditor("z".repeat(STOP_RENDERING_LINE_AFTER), 60, 3);
        const gw = editor.gutterWidth;
        // Scroll to the very end of the (non-truncated) line.
        vs.scrollLeft = STOP_RENDERING_LINE_AFTER - 10;
        app.render();

        const row = app.backend.getTextAt(new Point(gw, 0), 60 - gw);
        expect(row).not.toContain(BADGE_LABEL);
    });
});
