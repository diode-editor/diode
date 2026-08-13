import { describe, expect, it } from "vitest";

import { packRgb } from "@tuidom/all/common/colorUtils";
import { Point, Size } from "@tuidom/all/common/geometryPromitives";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createRange } from "../common/core/iRange.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

const BAR = "┃"; // solid — added/deleted
const BAR_DASHED = "┋"; // hatched — modified (VS Code dirty-diff style)
const ADDED = packRgb(0x48, 0x7e, 0x02);
const MODIFIED = packRgb(0x1b, 0x81, 0xa8);
const DELETED = packRgb(0xf1, 0x4c, 0x4c);

function makeEditor(content: string): EditorElement {
    const doc = new TextDocument(content);
    const editor = new EditorElement(new EditorViewState(doc));
    editor.occurrenceHighlightEnabled = false;
    return editor;
}

function render(editor: EditorElement): TestApp {
    const app = TestApp.createWithContent(editor, new Size(40, 6));
    app.render();
    return app;
}

/** The change bar lives in the fold-margin column immediately left of the chevron. */
function barColumn(editor: EditorElement): number {
    return editor.foldControlColumn - 1;
}

describe("EditorElement — gutter change-bars", () => {
    it("paints a solid bar in the fold-margin column only on changed lines", () => {
        const editor = makeEditor("l0\nl1\nl2\nl3");
        editor.gutterChangeDecorations = [{ range: createRange(1, 0, 2, 0), color: ADDED }];

        const app = render(editor);
        const x = barColumn(editor);

        // Lines 1 and 2 carry the bar, tinted with the change colour.
        for (const y of [1, 2]) {
            expect(app.backend.getTextAt(new Point(x, y), 1)).toBe(BAR);
            expect(app.backend.getFgAt(new Point(x, y))).toBe(ADDED);
        }
        // The lines just outside the range keep a blank fold margin (no bar).
        expect(app.backend.getTextAt(new Point(x, 0), 1)).toBe(" ");
        expect(app.backend.getTextAt(new Point(x, 3), 1)).toBe(" ");
    });

    it("paints a dashed bar for modified (dashed) decorations", () => {
        const editor = makeEditor("l0\nl1\nl2\nl3");
        editor.gutterChangeDecorations = [{ range: createRange(1, 0, 1, 0), color: MODIFIED, dashed: true }];

        const app = render(editor);
        const x = barColumn(editor);

        expect(app.backend.getTextAt(new Point(x, 1), 1)).toBe(BAR_DASHED);
        expect(app.backend.getFgAt(new Point(x, 1))).toBe(MODIFIED);
    });

    it("renders a deleted-hunk boundary as a single solid-bar line", () => {
        const editor = makeEditor("l0\nl1\nl2\nl3");
        editor.gutterChangeDecorations = [{ range: createRange(3, 0, 3, 0), color: DELETED }];

        const app = render(editor);
        const x = barColumn(editor);

        expect(app.backend.getTextAt(new Point(x, 3), 1)).toBe(BAR);
        expect(app.backend.getFgAt(new Point(x, 3))).toBe(DELETED);
        expect(app.backend.getTextAt(new Point(x, 2), 1)).toBe(" ");
    });

    it("keeps the line number and chevron column intact next to the bar", () => {
        const editor = makeEditor("l0\nl1\nl2\nl3");
        editor.gutterChangeDecorations = [{ range: createRange(0, 0, 0, 0), color: ADDED }];

        const app = render(editor);
        const x = barColumn(editor);

        // Line number "1" sits at the left of the gutter; the bar hugs the fold
        // margin one column left of the (here-empty) chevron column.
        expect(app.backend.getTextAt(new Point(2, 0), 1)).toBe("1");
        expect(app.backend.getTextAt(new Point(x, 0), 1)).toBe(BAR);
        expect(app.backend.getTextAt(new Point(editor.foldControlColumn, 0), 1)).toBe(" ");
    });

    it("draws no bars by default (empty decorations)", () => {
        const editor = makeEditor("l0\nl1");

        const app = render(editor);
        const x = barColumn(editor);

        expect(app.backend.getTextAt(new Point(x, 0), 1)).toBe(" ");
        expect(app.backend.getTextAt(new Point(x, 1), 1)).toBe(" ");
    });
});
