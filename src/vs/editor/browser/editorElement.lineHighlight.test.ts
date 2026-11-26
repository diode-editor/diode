import { compositeOver, packRgb, packRgba } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createRange } from "../common/core/iRange.ts";
import { createTextEdit } from "../common/core/iTextEdit.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";
import { computeIndentationFolds } from "../contrib/folding/foldingRangeProvider.ts";

import { EditorElement } from "./editorElement.ts";

const BG = packRgb(0x1e, 0x1e, 0x1e);
const GUTTER_BG = packRgb(0x20, 0x20, 0x20);
/** Translucent, as upstream's `editor.stackFrameHighlightBackground` (`#ffff0033`). */
const FRAME_BG = packRgba(0xff, 0xff, 0x00, 0x33);
const FRAME = compositeOver(FRAME_BG, BG);

function setup(text: string): { app: TestApp; editor: EditorElement } {
    const editor = new EditorElement(new EditorViewState(new TextDocument(text)));
    editor.occurrenceHighlightEnabled = false;
    editor.setStyleVars({
        "editor.background": BG,
        "editorGutter.background": GUTTER_BG,
        "editor.stackFrameHighlightBackground": FRAME_BG,
    });
    editor.style = { bg: "editor.background" };
    const app = TestApp.createWithContent(editor, new Size(24, 6));
    return { app, editor };
}

const highlight = (line: number) => ({ key: "frame", line, colorToken: "editor.stackFrameHighlightBackground" });

describe("EditorElement — line highlights", () => {
    it("paints the whole row of the text area over the editor background, not the gutter", () => {
        const { app, editor } = setup("alpha\nbeta\ngamma");
        editor.setLineHighlightDecorations([highlight(1)]);
        app.render();

        expect(app.backend.getBgAt(new Point(editor.gutterWidth, 1))).toBe(FRAME);
        expect(app.backend.getBgAt(new Point(editor.gutterWidth + 15, 1))).toBe(FRAME);
        expect(app.backend.getBgAt(new Point(0, 1))).not.toBe(FRAME);
        expect(app.backend.getBgAt(new Point(editor.gutterWidth, 2))).toBe(BG);
    });

    it("rides its line through an insertion above, is gone with its deleted line and when cleared", () => {
        const { app, editor } = setup("alpha\nbeta\ngamma");
        const x = editor.gutterWidth + 1;
        editor.setLineHighlightDecorations([highlight(1)]);
        editor.viewState.document.applyEdits([createTextEdit(createRange(0, 0, 0, 0), "top\n")]);
        app.render();
        expect(app.backend.getBgAt(new Point(x, 1))).toBe(BG);
        expect(app.backend.getBgAt(new Point(x, 2))).toBe(FRAME);

        editor.viewState.document.applyEdits([createTextEdit(createRange(2, 0, 3, 0), "")]);
        app.render();
        expect([0, 1, 2].map((y) => app.backend.getBgAt(new Point(x, y)))).not.toContain(FRAME);

        editor.setLineHighlightDecorations([highlight(0)]);
        editor.setLineHighlightDecorations([]);
        app.render();
        expect(app.backend.getBgAt(new Point(x, 0))).toBe(BG);
    });

    it("paints the indent guide's cell of the row too, not only the text past it", () => {
        const { app, editor } = setup("if (x) {\n    beta;\n}");
        editor.viewState.setFoldingRegions(
            computeIndentationFolds(editor.viewState.document, editor.viewState.tabSize),
        );
        editor.setLineHighlightDecorations([highlight(1)]);
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gw, 1), 1)).toBe("▏");
        expect([0, 1, 2, 3, 4].map((dx) => app.backend.getBgAt(new Point(gw + dx, 1)))).toEqual(
            [0, 1, 2, 3, 4].map(() => FRAME),
        );
    });
});
