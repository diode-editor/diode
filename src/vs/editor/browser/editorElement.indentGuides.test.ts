import { describe, expect, it } from "vitest";

import { packRgb } from "@tuidom/all/common/colorUtils";
import { Point, Size } from "@tuidom/all/common/geometryPromitives";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createCursorSelection } from "../common/core/iSelection.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";
import { computeIndentationFolds } from "../contrib/folding/foldingRangeProvider.ts";
import { createFoldingRegion } from "../contrib/folding/iFoldingRegion.ts";

import { EditorElement } from "./editorElement.ts";

const GUIDE = "│";

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
        // Region A (indent 0): guide at content col 0 on every body line (1..7).
        expect(app.backend.getTextAt(new Point(gw, 1), 1)).toBe(GUIDE);
        expect(app.backend.getTextAt(new Point(gw, 7), 1)).toBe(GUIDE);
    });

    it("does not draw a guide on the region's header line", () => {
        const { app, editor } = createEditor(SAMPLE);
        app.render();
        const gw = editor.gutterWidth;
        // Line 0 is region A's header — its first content char is "f", not a guide.
        expect(app.backend.getTextAt(new Point(gw, 0), 1)).toBe("f");
    });

    it("does not draw a guide past a region's last body line", () => {
        const { app, editor } = createEditor(SAMPLE);
        app.render();
        const gw = editor.gutterWidth;
        // Line 8 ("}") is outside region A (endLine 7) → no guide, just "}".
        expect(app.backend.getTextAt(new Point(gw, 8), 1)).toBe("}");
    });

    it("draws a deeper nested guide for the inner region", () => {
        const { app, editor } = createEditor(SAMPLE);
        app.render();
        const gw = editor.gutterWidth;
        // Line 3 ("    return x;") sits in both region A (col 0) and region B (col 2).
        expect(app.backend.getTextAt(new Point(gw, 3), 1)).toBe(GUIDE);
        expect(app.backend.getTextAt(new Point(gw + 2, 3), 1)).toBe(GUIDE);
    });

    it("highlights the innermost region enclosing the cursor as active", () => {
        // Cursor inside the if-body (region B). Its guide (col 2) is active; the
        // enclosing region A guide (col 0) stays inactive.
        const { app, editor } = createEditor(SAMPLE, 3);
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getFgAt(new Point(gw + 2, 3))).toBe(GUIDE_ACTIVE_FG);
        expect(app.backend.getFgAt(new Point(gw, 3))).toBe(GUIDE_FG);
    });

    it("activates the outer region when the cursor is at its level only", () => {
        // Cursor on line 1 ("const x") — inside region A only. A's guide is active.
        const { app, editor } = createEditor(SAMPLE, 1);
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getFgAt(new Point(gw, 1))).toBe(GUIDE_ACTIVE_FG);
        // A sibling region's guide (region C body, line 6, col 2) stays inactive.
        expect(app.backend.getFgAt(new Point(gw + 2, 6))).toBe(GUIDE_FG);
    });

    it("switches the active guide between sibling regions with the cursor", () => {
        const { app, editor } = createEditor(SAMPLE, 6); // inside while-body (region C)
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getFgAt(new Point(gw + 2, 6))).toBe(GUIDE_ACTIVE_FG);
        // The if-body guide (region B, line 3) is now inactive.
        expect(app.backend.getFgAt(new Point(gw + 2, 3))).toBe(GUIDE_FG);
    });

    it("uses theme-provided guide colours when set", () => {
        const fg = packRgb(11, 22, 33);
        const activeFg = packRgb(200, 210, 220);
        const { app, editor } = createEditor(SAMPLE, 3);
        editor.setStyleVars({ "editorIndentGuide.background1": fg, "editorIndentGuide.activeBackground1": activeFg });
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getFgAt(new Point(gw + 2, 3))).toBe(activeFg); // active (if-body)
        expect(app.backend.getFgAt(new Point(gw, 3))).toBe(fg); // inactive (function body)
    });

    it("draws no guide for a collapsed region's hidden body", () => {
        const { app, editor } = createEditor(SAMPLE);
        // Collapse region A — its whole body is hidden, so no guides remain visible.
        editor.viewState.toggleFold(0);
        app.render();
        const gw = editor.gutterWidth;
        // Row 1 now shows line 8 ("}", the next visible logical line), no guide.
        expect(app.backend.getTextAt(new Point(gw, 0), 1)).toBe("f");
        expect(app.backend.getTextAt(new Point(gw, 1), 1)).toBe("}");
    });

    it("shifts guides with horizontal scroll and drops those scrolled off the left", () => {
        const { app, editor } = createEditor(SAMPLE, 3);
        editor.viewState.scrollLeft = 2; // col-0 guide moves under the gutter → gone
        app.render();
        const gw = editor.gutterWidth;
        // Region B's guide was at col 2 → now at content col 0.
        expect(app.backend.getTextAt(new Point(gw, 3), 1)).toBe(GUIDE);
        // Region A's col-0 guide scrolled off the left edge — first cell is not it
        // (it shows the shifted "return x;" text, "t" at content col 0 after "re").
        expect(app.backend.getTextAt(new Point(gw, 3), 1)).not.toBe(" ");
    });

    it("skips regions that lie entirely outside the visible window", () => {
        // Viewport shows only lines 0..2, so regions B (2..3) and C (5..6) are
        // below the fold — their body ranges clip empty and are skipped.
        const { app, editor } = createEditor(SAMPLE, 0, 34, 3);
        app.render();
        const gw = editor.gutterWidth;
        // Region A still draws within the window.
        expect(app.backend.getTextAt(new Point(gw, 1), 1)).toBe(GUIDE);
        // Region C's body (line 6) is off-screen, nothing drawn / no throw.
        expect(app.backend.getTextAt(new Point(gw + 2, 1), 1)).not.toBe(GUIDE);
    });

    it("drops guides whose indent column falls past the right edge", () => {
        // contentCols = 2 (width 8 − gutterWidth 6): region B's col-2 guide lands
        // at the first off-screen column and is dropped; region A's col-0 stays.
        const { app, editor } = createEditor(SAMPLE, 3, 8, 9);
        app.render();
        const gw = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gw, 3), 1)).toBe(GUIDE); // region A, col 0
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
        editor.viewState.scrollTop = 20; // past the last line → no visible lines
        app.render();
        const gw = editor.gutterWidth;
        // Whole viewport is blank; the guide pass returns early (no visible lines).
        expect(app.backend.getTextAt(new Point(gw, 0), 1)).toBe(" ");
    });
});

// Regions contributed by an extension provider (`languages.provideFoldingRanges`,
// e.g. maptz.regionfolder's `#region` markers) break the assumption indentation
// folds satisfy for free: the header sits at the SAME indent as its body, so the
// guide column lands on real code instead of leading whitespace (#194).
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
        // The provider region's column (2) is exactly where "const a = 1;" starts —
        // the guide must yield to the code, not eat its first character.
        expect(app.backend.getTextAt(new Point(gw + 2, 2), 1)).toBe("c");
        expect(app.backend.getTextAt(new Point(gw + 2, 4), 1)).toBe("/");
    });

    it("still carries the guide through a blank body line", () => {
        const { app, editor } = createWithProviderRegion();
        app.render();
        const gw = editor.gutterWidth;
        // Line 3 is empty: nothing to hide, so the guide is drawn (as in VS Code).
        expect(app.backend.getTextAt(new Point(gw + 2, 3), 1)).toBe(GUIDE);
    });

    it("keeps the enclosing indentation region's guide, which does land on whitespace", () => {
        const { app, editor } = createWithProviderRegion();
        app.render();
        const gw = editor.gutterWidth;
        // The outer region's column (0) is inside the body's leading whitespace.
        expect(app.backend.getTextAt(new Point(gw, 2), 1)).toBe(GUIDE);
    });
});
