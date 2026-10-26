import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { WorkbenchTheme } from "../../platform/theme/common/workbenchTheme.ts";
import { createCursorSelection } from "../common/core/iSelection.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";
import { computeIndentationFolds } from "../contrib/folding/foldingRangeProvider.ts";
import { createFoldingRegion } from "../contrib/folding/iFoldingRegion.ts";

import { EditorElement } from "./editorElement.ts";

const GUIDE = "▏";

// 0: function foo() {   ← region A (0..7), indent 0
// 1:   const x = 1;
// 2:   if (x) {         ← region B (2..3), indent 2
// 3:     return x;
// 4:   }
// 5:   while (x) {      ← region C (5..6), indent 2
// 6:     x = x - 1;
// 7:   }
// 8: }
const SAMPLE = [
    "function foo() {",
    "  const x = 1;",
    "  if (x) {",
    "    return x;",
    "  }",
    "  while (x) {",
    "    x = x - 1;",
    "  }",
    "}",
].join("\n");

const GUIDE_FG = packRgb(0x40, 0x40, 0x40); // default editorIndentGuide.background1
const GUIDE_ACTIVE_FG = packRgb(0x70, 0x70, 0x70); // default editorIndentGuide.activeBackground1

function createEditor(text: string, cursorLine = 0, width = 34, height = 9): { app: TestApp; editor: EditorElement } {
    const doc = new TextDocument(text);
    const viewState = new EditorViewState(doc);
    viewState.setFoldingRegions(computeIndentationFolds(doc, viewState.tabSize));
    viewState.selections = [createCursorSelection(cursorLine, 0)];
    const editor = new EditorElement(viewState);
    const app = TestApp.createWithContent(editor, new Size(width, height));
    return { app, editor };
}

describe("EditorElement – indentation guides", () => {
    it("draws a guide over a region's body at the header's indent column", () => {
        const { app, editor } = createEditor(SAMPLE);
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gw, 1), 1)).toBe(GUIDE);
        expect(app.backend.getTextAt(new Point(gw, 7), 1)).toBe(GUIDE);
    });

    it("does not draw a guide on the region's header line", () => {
        const { app, editor } = createEditor(SAMPLE);
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gw, 0), 1)).toBe("f");
    });

    it("does not draw a guide past a region's last body line", () => {
        const { app, editor } = createEditor(SAMPLE);
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gw, 8), 1)).toBe("}");
    });

    it("draws a deeper nested guide for the inner region", () => {
        const { app, editor } = createEditor(SAMPLE);
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gw, 3), 1)).toBe(GUIDE);
        expect(app.backend.getTextAt(new Point(gw + 2, 3), 1)).toBe(GUIDE);
    });

    it("highlights the innermost region enclosing the cursor as active", () => {
        // Cursor in the body of if (B): its guide is active, not the enclosing A.
        const { app, editor } = createEditor(SAMPLE, 3);
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getFgAt(new Point(gw + 2, 3))).toBe(GUIDE_ACTIVE_FG);
        expect(app.backend.getFgAt(new Point(gw, 3))).toBe(GUIDE_FG);
    });

    it("activates the outer region when the cursor is at its level only", () => {
        const { app, editor } = createEditor(SAMPLE, 1);
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getFgAt(new Point(gw, 1))).toBe(GUIDE_ACTIVE_FG);
        expect(app.backend.getFgAt(new Point(gw + 2, 6))).toBe(GUIDE_FG);
    });

    it("switches the active guide between sibling regions with the cursor", () => {
        const { app, editor } = createEditor(SAMPLE, 6);
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getFgAt(new Point(gw + 2, 6))).toBe(GUIDE_ACTIVE_FG);
        expect(app.backend.getFgAt(new Point(gw + 2, 3))).toBe(GUIDE_FG);
    });

    it("uses theme-provided guide colours when set", () => {
        const fg = packRgb(11, 22, 33);
        const activeFg = packRgb(200, 210, 220);
        const { app, editor } = createEditor(SAMPLE, 3);
        editor.setStyleVars({ "editorIndentGuide.background1": fg, "editorIndentGuide.activeBackground1": activeFg });
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getFgAt(new Point(gw + 2, 3))).toBe(activeFg);
        expect(app.backend.getFgAt(new Point(gw, 3))).toBe(fg);
    });

    it("takes guide colours from the deprecated editorIndentGuide keys a theme like Monokai sets", () => {
        const theme = WorkbenchTheme.fromThemeFile({
            name: "monokai-like",
            type: "dark",
            colors: { "editorIndentGuide.background": "#464741", "editorIndentGuide.activeBackground": "#767771" },
        });
        const { app, editor } = createEditor(SAMPLE, 3);
        editor.setStyleVars(theme.colors);
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gw + 2, 3), 1)).toBe(GUIDE);
        expect(app.backend.getFgAt(new Point(gw + 2, 3))).toBe(packRgb(0x76, 0x77, 0x71));
        expect(app.backend.getFgAt(new Point(gw, 3))).toBe(packRgb(0x46, 0x47, 0x41));
    });

    it("draws no guide for a collapsed region's hidden body", () => {
        const { app, editor } = createEditor(SAMPLE);
        editor.viewState.toggleFold(0);
        app.render();
        const gw = editor.gutterWidth;
        // Row 1 now shows line 8 ("}").
        expect(app.backend.getTextAt(new Point(gw, 0), 1)).toBe("f");
        expect(app.backend.getTextAt(new Point(gw, 1), 1)).toBe("}");
    });

    it("shifts guides with horizontal scroll and drops those scrolled off the left", () => {
        const { app, editor } = createEditor(SAMPLE, 3);
        editor.viewState.scrollLeft = 2;
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gw, 3), 1)).toBe(GUIDE);
        // Guide A (col. 0) went past the left edge; line text is there.
        expect(app.backend.getTextAt(new Point(gw, 3), 1)).not.toBe(" ");
    });

    it("skips regions that lie entirely outside the visible window", () => {
        // Viewport is lines 0..2: the bodies of B and C are outside, their ranges clip to nothing.
        const { app, editor } = createEditor(SAMPLE, 0, 34, 3);
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gw, 1), 1)).toBe(GUIDE);
        expect(app.backend.getTextAt(new Point(gw + 2, 1), 1)).not.toBe(GUIDE);
    });

    it("drops guides whose indent column falls past the right edge", () => {
        // contentCols = 2 (width 8 − gutterWidth 6): guide B (col. 2) is the first column past the edge.
        const { app, editor } = createEditor(SAMPLE, 3, 8, 9);
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gw, 3), 1)).toBe(GUIDE);
    });

    it("renders nothing when the document has no foldable regions", () => {
        const { app, editor } = createEditor("a\nb\nc");
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gw, 0), 1)).toBe("a");
        expect(app.backend.getTextAt(new Point(gw, 1), 1)).toBe("b");
    });

    it("draws no guides when scrolled entirely past the document", () => {
        const { app, editor } = createEditor(SAMPLE);
        editor.viewState.scrollTop = 20;
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gw, 0), 1)).toBe(" ");
    });
});

// Provider regions (`#region`) share the body's indent, so a guide would land on code (#194).
describe("EditorElement – indentation guides, provider regions", () => {
    // 0: function foo() {   ← indentation region (0..4), indent 0
    // 1:   /* #region */    ← provider region (1..4), indent 2 — same as its body
    // 2:   const a = 1;
    // 3:                    ← blank
    // 4:   /* #endregion */
    // 5: }
    const REGION_SAMPLE = ["function foo() {", "  /* #region */", "  const a = 1;", "", "  /* #endregion */", "}"].join(
        "\n",
    );

    function createWithProviderRegion(cursorLine = 0): { app: TestApp; editor: EditorElement } {
        const doc = new TextDocument(REGION_SAMPLE);
        const viewState = new EditorViewState(doc);
        viewState.setFoldingRegions([
            ...computeIndentationFolds(doc, viewState.tabSize),
            createFoldingRegion(1, 4, false),
        ]);
        viewState.selections = [createCursorSelection(cursorLine, 0)];
        const editor = new EditorElement(viewState);
        const app = TestApp.createWithContent(editor, new Size(34, 6));
        return { app, editor };
    }

    it("never paints a guide over a body line's code", () => {
        const { app, editor } = createWithProviderRegion();
        app.render();
        const gw = editor.gutterWidth;
        // The provider region column (2) is exactly the start of "const a = 1;".
        expect(app.backend.getTextAt(new Point(gw + 2, 2), 1)).toBe("c");
        expect(app.backend.getTextAt(new Point(gw + 2, 4), 1)).toBe("/");
    });

    it("still carries the guide through a blank body line", () => {
        const { app, editor } = createWithProviderRegion();
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gw + 2, 3), 1)).toBe(GUIDE);
    });

    it("keeps the enclosing indentation region's guide, which does land on whitespace", () => {
        const { app, editor } = createWithProviderRegion();
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gw, 2), 1)).toBe(GUIDE);
    });
});
