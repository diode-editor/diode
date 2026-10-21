import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";
import { createFoldingRegion } from "../contrib/folding/iFoldingRegion.ts";

import { EditorElement } from "./editorElement.ts";

function createEditor(text: string, width = 30, height = 10): { app: TestApp; editor: EditorElement } {
    const doc = new TextDocument(text);
    const viewState = new EditorViewState(doc);
    const editor = new EditorElement(viewState);
    const app = TestApp.createWithContent(editor, new Size(width, height));
    return { app, editor };
}

// Gutter: 2 padding columns + digits + 3 folding columns (gap, chevron, gap).

describe("gutterWidth", () => {
    it("returns GUTTER_LEFT_PADDING + 1 digit + 3 fold margin for 1–9 lines", () => {
        const { editor } = createEditor("a\nb\nc");
        // 3 lines → 1 digit → 2 + 1 + 3 = 6
        expect(editor.gutterWidth).toBe(6);
    });

    it("returns GUTTER_LEFT_PADDING + 2 digits + 3 fold margin for 10–99 lines", () => {
        const lines = Array.from({ length: 15 }, (_, i) => `line ${String(i + 1)}`).join("\n");
        const { editor } = createEditor(lines);
        // 15 lines → 2 digits → 2 + 2 + 3 = 7
        expect(editor.gutterWidth).toBe(7);
    });

    it("returns GUTTER_LEFT_PADDING + 3 digits + 3 fold margin for 100–999 lines", () => {
        const lines = Array.from({ length: 100 }, (_, i) => String(i)).join("\n");
        const { editor } = createEditor(lines);
        // 100 lines → 3 digits → 2 + 3 + 3 = 8
        expect(editor.gutterWidth).toBe(8);
    });

    it("returns at least 1 digit for a single-line document", () => {
        const { editor } = createEditor("hello");
        // 1 line → 1 digit → 2 + 1 + 3 = 6
        expect(editor.gutterWidth).toBe(6);
    });

    it("keeps the digit column sized by logical lines when folding shrinks the view below a power of ten", () => {
        const lines = Array.from({ length: 150 }, (_, i) => (i === 0 ? "header" : `  body ${String(i)}`)).join("\n");
        const { editor } = createEditor(lines);
        editor.viewState.setFoldingRegions([createFoldingRegion(0, 148, true)]);
        // 2 view lines remain, but logical numbers go up to 150 → still 3 digits → 2 + 3 + 3 = 8
        expect(editor.viewState.getViewLineCount()).toBe(2);
        expect(editor.gutterWidth).toBe(8);
    });
});

describe("gutter rendering", () => {
    it("renders line numbers right-aligned with left padding", () => {
        const { app } = createEditor("AAA\nBBB\nCCC", 15, 5);
        app.render();

        const backend = app.backend;
        expect(backend.getTextAt(new Point(0, 0), 6)).toBe("  1   ");
        expect(backend.getTextAt(new Point(0, 1), 6)).toBe("  2   ");
        expect(backend.getTextAt(new Point(0, 2), 6)).toBe("  3   ");
    });

    it("pads line numbers for multi-digit counts", () => {
        const lines = Array.from({ length: 12 }, (_, i) => String.fromCharCode(65 + (i % 26))).join("\n");
        const { app } = createEditor(lines, 20, 12);
        app.render();

        const backend = app.backend;
        expect(backend.getTextAt(new Point(0, 0), 7)).toBe("   1   ");
        expect(backend.getTextAt(new Point(0, 8), 7)).toBe("   9   ");
        expect(backend.getTextAt(new Point(0, 9), 7)).toBe("  10   ");
        expect(backend.getTextAt(new Point(0, 11), 7)).toBe("  12   ");
    });

    it("renders full logical line numbers when folding shrinks the view below a power of ten", () => {
        const lines = Array.from({ length: 150 }, (_, i) => (i === 0 ? "header" : `  body ${String(i)}`)).join("\n");
        const { app, editor } = createEditor(lines, 20, 5);
        editor.viewState.setFoldingRegions([createFoldingRegion(0, 148, true)]);
        app.render();

        const backend = app.backend;
        // Row 1 is logical line 150: its last digit must survive the folded
        // projection (regression: it showed "15"). Row 0 has a chevron, so only digits are checked.
        expect(backend.getTextAt(new Point(0, 0), 6)).toBe("    1 ");
        expect(backend.getTextAt(new Point(0, 1), 8)).toBe("  150   ");
    });

    it("renders empty gutter and content past end of document (no tildes)", () => {
        const { app } = createEditor("One\nTwo", 15, 5);
        app.render();

        const backend = app.backend;
        // VS Code does not draw vim tildes past the end of the document.
        expect(backend.getTextAt(new Point(0, 2), 6)).toBe("      ");
        expect(backend.getTextAt(new Point(0, 3), 6)).toBe("      ");
        expect(backend.getTextAt(new Point(0, 4), 6)).toBe("      ");
    });

    it("renders content shifted right by gutterWidth", () => {
        const { app } = createEditor("Hello", 20, 3);
        app.render();

        const backend = app.backend;
        expect(backend.getTextAt(new Point(6, 0), 5)).toBe("Hello");
    });

    it("full screen rendering matches expected layout", () => {
        const { app } = createEditor("AB\nCD\nEF", 10, 5);
        app.render();

        const backend = app.backend;
        expect(backend.getTextAt(new Point(0, 0), 10)).toBe("  1   AB  ");
        expect(backend.getTextAt(new Point(0, 1), 10)).toBe("  2   CD  ");
        expect(backend.getTextAt(new Point(0, 2), 10)).toBe("  3   EF  ");
        expect(backend.getTextAt(new Point(0, 3), 10)).toBe("          ");
        expect(backend.getTextAt(new Point(0, 4), 10)).toBe("          ");
    });
});

describe("gutter colors", () => {
    it("uses lineNumberForeground for non-active lines", () => {
        const lnFg = packRgb(100, 100, 100);
        const { app, editor } = createEditor("AAA\nBBB\nCCC", 15, 5);
        editor.setStyleVars({ "editorLineNumber.foreground": lnFg });
        app.render();

        const backend = app.backend;
        // Row 0 is active (cursor on line 0), so row 1 is checked.
        expect(backend.getFgAt(new Point(2, 1))).toBe(lnFg);
    });

    it("uses lineNumberActiveForeground for the cursor line", () => {
        const lnActiveFg = packRgb(200, 200, 200);
        const { app, editor } = createEditor("AAA\nBBB\nCCC", 15, 5);
        editor.setStyleVars({ "editorLineNumber.activeForeground": lnActiveFg });
        app.render();

        const backend = app.backend;
        expect(backend.getFgAt(new Point(2, 0))).toBe(lnActiveFg);
    });

    it("uses gutterBackground for gutter area", () => {
        const gutBg = packRgb(20, 20, 20);
        const { app, editor } = createEditor("AAA\nBBB", 15, 4);
        editor.setStyleVars({ "editorGutter.background": gutBg });
        app.render();

        const backend = app.backend;
        for (let x = 0; x < 6; x++) {
            expect(backend.getBgAt(new Point(x, 0))).toBe(gutBg);
            expect(backend.getBgAt(new Point(x, 1))).toBe(gutBg);
        }
    });

    it("uses editor resolved style bg for content area", () => {
        const editorBg = packRgb(30, 30, 30);
        const { app, editor } = createEditor("Hi", 15, 3);
        editor.occurrenceHighlightEnabled = false; // isolate editor-bg from word highlighting
        editor.style = { bg: editorBg };
        app.render();

        const backend = app.backend;
        expect(backend.getBgAt(new Point(6, 0))).toBe(editorBg);
        expect(backend.getBgAt(new Point(7, 0))).toBe(editorBg);
    });

    it("uses editor resolved style fg for text", () => {
        const editorFg = packRgb(212, 212, 212);
        const { app, editor } = createEditor("Hi", 15, 3);
        editor.style = { fg: editorFg };
        app.render();

        const backend = app.backend;
        expect(backend.getFgAt(new Point(6, 0))).toBe(editorFg);
    });

    it("defaults gutter bg to editor bg when gutterBackground is not set", () => {
        const editorBg = packRgb(40, 40, 40);
        const { app, editor } = createEditor("Hi", 15, 3);
        editor.style = { bg: editorBg };
        app.render();

        const backend = app.backend;
        expect(backend.getBgAt(new Point(0, 0))).toBe(editorBg);
        expect(backend.getBgAt(new Point(2, 0))).toBe(editorBg);
    });

    it("follows the editor background when gutterBackgroundToken is cleared", () => {
        const editorBg = packRgb(25, 26, 27);
        const gutterBg = packRgb(18, 19, 20);

        // A theme that pins editorGutter.background to the editor background (dark2026): Output has its own background.
        const themed = createEditor("Hi", 15, 3);
        themed.editor.setStyleVars({ "editorGutter.background": gutterBg });
        themed.editor.style = { bg: editorBg };
        themed.app.render();
        expect(themed.app.backend.getBgAt(new Point(0, 0))).toBe(gutterBg);

        const cleared = createEditor("Hi", 15, 3);
        cleared.editor.setStyleVars({ "editorGutter.background": gutterBg });
        cleared.editor.style = { bg: editorBg };
        cleared.editor.gutterBackgroundToken = null;
        cleared.app.render();
        expect(cleared.app.backend.getBgAt(new Point(0, 0))).toBe(editorBg);
    });

    it("uses default line number colors when not explicitly set", () => {
        const { app } = createEditor("AAA\nBBB", 15, 4);
        app.render();

        const backend = app.backend;
        const defaultLnFg = packRgb(133, 133, 133);
        const defaultLnActiveFg = packRgb(198, 198, 198);

        expect(backend.getFgAt(new Point(2, 0))).toBe(defaultLnActiveFg);
        expect(backend.getFgAt(new Point(2, 1))).toBe(defaultLnFg);
    });
});

describe("content area rendering", () => {
    it("renders text content after gutter", () => {
        const { app } = createEditor("Hello World", 20, 3);
        app.render();

        const backend = app.backend;
        expect(backend.getTextAt(new Point(6, 0), 11)).toBe("Hello World");
    });

    it("fills remaining space with spaces for short lines", () => {
        const { app } = createEditor("Hi", 12, 2);
        app.render();

        const backend = app.backend;
        expect(backend.getTextAt(new Point(6, 0), 6)).toBe("Hi    ");
    });

    it("handles empty document", () => {
        const { app } = createEditor("", 12, 3);
        app.render();

        const backend = app.backend;
        expect(backend.getTextAt(new Point(0, 0), 6)).toBe("  1   ");
        expect(backend.getTextAt(new Point(6, 1), 1)).toBe(" ");
    });

    it("correctly shows selection background in content area", () => {
        const selBg = packRgb(38, 79, 120);
        const { app, editor } = createEditor("Hello World", 20, 3);
        editor.viewState.selections = [{ anchor: { line: 0, character: 1 }, active: { line: 0, character: 5 } }];
        app.render();

        const backend = app.backend;
        expect(backend.getBgAt(new Point(7, 0))).toBe(selBg);
        expect(backend.getBgAt(new Point(8, 0))).toBe(selBg);
        expect(backend.getBgAt(new Point(9, 0))).toBe(selBg);
        expect(backend.getBgAt(new Point(10, 0))).toBe(selBg);
    });
});

describe("scrolling", () => {
    const tenLines = Array.from({ length: 10 }, (_, i) => `Line${String(i + 1)}`).join("\n");

    describe("vertical scroll", () => {
        it("shows correct line numbers after scrolling down", () => {
            // 10 lines, viewport height = 4 → gutterWidth = 7 (2+2+3)
            const { app, editor } = createEditor(tenLines, 20, 4);
            editor.viewState.scrollTop = 3;
            app.render();

            const backend = app.backend;
            expect(backend.getTextAt(new Point(0, 0), 7)).toBe("   4   ");
            expect(backend.getTextAt(new Point(0, 1), 7)).toBe("   5   ");
            expect(backend.getTextAt(new Point(0, 2), 7)).toBe("   6   ");
            expect(backend.getTextAt(new Point(0, 3), 7)).toBe("   7   ");
        });

        it("shows correct content after scrolling down", () => {
            const { app, editor } = createEditor(tenLines, 20, 4);
            editor.viewState.scrollTop = 3;
            app.render();

            const backend = app.backend;
            expect(backend.getTextAt(new Point(7, 0), 5)).toBe("Line4");
            expect(backend.getTextAt(new Point(7, 1), 5)).toBe("Line5");
        });

        it("shows blank rows when scrolled near end of document", () => {
            const { app, editor } = createEditor(tenLines, 20, 4);
            editor.viewState.scrollTop = 8;
            app.render();

            const backend = app.backend;
            expect(backend.getTextAt(new Point(0, 0), 7)).toBe("   9   ");
            expect(backend.getTextAt(new Point(0, 1), 7)).toBe("  10   ");
            expect(backend.getTextAt(new Point(0, 2), 7)).toBe("       ");
            expect(backend.getTextAt(new Point(0, 3), 7)).toBe("       ");
        });

        it("highlights active line number after scroll", () => {
            const lnFg = packRgb(100, 100, 100);
            const lnActiveFg = packRgb(200, 200, 200);
            const { app, editor } = createEditor(tenLines, 20, 4);
            editor.setStyleVars({
                "editorLineNumber.foreground": lnFg,
                "editorLineNumber.activeForeground": lnActiveFg,
            });
            editor.viewState.selections = [{ anchor: { line: 5, character: 0 }, active: { line: 5, character: 0 } }];
            editor.viewState.scrollTop = 3;
            app.render();

            const backend = app.backend;
            // scrollTop=3: line 5 is at screenY=2.
            expect(backend.getFgAt(new Point(2, 2))).toBe(lnActiveFg);
            expect(backend.getFgAt(new Point(2, 0))).toBe(lnFg);
        });
    });

    describe("horizontal scroll", () => {
        it("shows correct content after horizontal scroll", () => {
            const { app, editor } = createEditor("ABCDEFGHIJKLMNOP", 12, 2);
            // gutterWidth = 6, contentCols = 6
            editor.viewState.scrollLeft = 3;
            app.render();

            const backend = app.backend;
            expect(backend.getTextAt(new Point(6, 0), 6)).toBe("DEFGHI");
        });

        it("gutter is not affected by horizontal scroll", () => {
            const { app, editor } = createEditor("ABCDEFGHIJKLMNOP", 12, 2);
            editor.viewState.scrollLeft = 5;
            app.render();

            const backend = app.backend;
            expect(backend.getTextAt(new Point(0, 0), 6)).toBe("  1   ");
        });

        it("fills with spaces when scrolled past line content", () => {
            const { app, editor } = createEditor("Hi", 12, 2);
            // gutterWidth = 6, contentCols = 6
            editor.viewState.scrollLeft = 1;
            app.render();

            const backend = app.backend;
            expect(backend.getTextAt(new Point(6, 0), 6)).toBe("i     ");
        });
    });

    describe("combined vertical + horizontal scroll", () => {
        it("applies both scroll offsets correctly", () => {
            const lines = Array.from({ length: 10 }, (_, i) => `ABCDEFGH_${String(i + 1)}`).join("\n");
            const { app, editor } = createEditor(lines, 16, 3);
            // gutterWidth = 7 (2+2+3), contentCols = 9
            editor.viewState.scrollTop = 4;
            editor.viewState.scrollLeft = 2;
            app.render();

            const backend = app.backend;
            expect(backend.getTextAt(new Point(0, 0), 7)).toBe("   5   ");
            expect(backend.getTextAt(new Point(0, 1), 7)).toBe("   6   ");
            expect(backend.getTextAt(new Point(7, 0), 8)).toBe("CDEFGH_5");
        });
    });
});
