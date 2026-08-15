import { describe, expect, it } from "vitest";

import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
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

// The gutter reserves a 3-column fold margin after the digits: a blank gap, the
// fold-control column (chevron on foldable headers), and a blank gap before text.

// ─── gutterWidth ────────────────────────────────────────────

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

// ─── Gutter rendering ───────────────────────────────────────

describe("gutter rendering", () => {
    it("renders line numbers right-aligned with left padding", () => {
        const { app } = createEditor("AAA\nBBB\nCCC", 15, 5);
        app.render();

        const backend = app.backend;
        // gutterWidth = 6 (2 pad + 1 digit + 3 fold margin)
        // Row 0: "  1   AAA      "
        // Row 1: "  2   BBB      "
        // Row 2: "  3   CCC      "
        expect(backend.getTextAt(new Point(0, 0), 6)).toBe("  1   ");
        expect(backend.getTextAt(new Point(0, 1), 6)).toBe("  2   ");
        expect(backend.getTextAt(new Point(0, 2), 6)).toBe("  3   ");
    });

    it("pads line numbers for multi-digit counts", () => {
        const lines = Array.from({ length: 12 }, (_, i) => String.fromCharCode(65 + (i % 26))).join("\n");
        const { app } = createEditor(lines, 20, 12);
        app.render();

        const backend = app.backend;
        // gutterWidth = 7 (2 pad + 2 digits + 3 fold margin)
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
        // gutterWidth = 8 (2 pad + 3 digits + 3 fold margin); row 1 is logical line 150,
        // whose units digit must survive the fold-shrunken view (regression: showed "15").
        // Row 0 is the collapsed header — its fold column holds a chevron, so only
        // the digit part is asserted there.
        expect(backend.getTextAt(new Point(0, 0), 6)).toBe("    1 ");
        expect(backend.getTextAt(new Point(0, 1), 8)).toBe("  150   ");
    });

    it("renders empty gutter and content past end of document (no tildes)", () => {
        const { app } = createEditor("One\nTwo", 15, 5);
        app.render();

        const backend = app.backend;
        // Lines 0,1 have content; lines 2,3,4 should be fully blank (no vim-style tildes)
        // gutterWidth = 6
        expect(backend.getTextAt(new Point(0, 2), 6)).toBe("      ");
        expect(backend.getTextAt(new Point(0, 3), 6)).toBe("      ");
        expect(backend.getTextAt(new Point(0, 4), 6)).toBe("      ");
    });

    it("renders content shifted right by gutterWidth", () => {
        const { app } = createEditor("Hello", 20, 3);
        app.render();

        const backend = app.backend;
        // gutterWidth = 6
        expect(backend.getTextAt(new Point(6, 0), 5)).toBe("Hello");
    });

    it("full screen rendering matches expected layout", () => {
        const { app } = createEditor("AB\nCD\nEF", 10, 5);
        app.render();

        const backend = app.backend;
        // gutterWidth = 6
        expect(backend.getTextAt(new Point(0, 0), 10)).toBe("  1   AB  ");
        expect(backend.getTextAt(new Point(0, 1), 10)).toBe("  2   CD  ");
        expect(backend.getTextAt(new Point(0, 2), 10)).toBe("  3   EF  ");
        expect(backend.getTextAt(new Point(0, 3), 10)).toBe("          ");
        expect(backend.getTextAt(new Point(0, 4), 10)).toBe("          ");
    });
});

// ─── Gutter colors ──────────────────────────────────────────

describe("gutter colors", () => {
    it("uses lineNumberForeground for non-active lines", () => {
        const lnFg = packRgb(100, 100, 100);
        const { app, editor } = createEditor("AAA\nBBB\nCCC", 15, 5);
        editor.setStyleVars({ "editorLineNumber.foreground": lnFg });
        app.render();

        const backend = app.backend;
        // Line 1 (row 0) is active (cursor is at line 0), so check line 2 (row 1)
        // Digit "2" is at column 2 (after 2-char padding)
        expect(backend.getFgAt(new Point(2, 1))).toBe(lnFg);
    });

    it("uses lineNumberActiveForeground for the cursor line", () => {
        const lnActiveFg = packRgb(200, 200, 200);
        const { app, editor } = createEditor("AAA\nBBB\nCCC", 15, 5);
        editor.setStyleVars({ "editorLineNumber.activeForeground": lnActiveFg });
        app.render();

        const backend = app.backend;
        // Cursor is at line 0 → row 0 is active → digit "1" at column 2
        expect(backend.getFgAt(new Point(2, 0))).toBe(lnActiveFg);
    });

    it("uses gutterBackground for gutter area", () => {
        const gutBg = packRgb(20, 20, 20);
        const { app, editor } = createEditor("AAA\nBBB", 15, 4);
        editor.setStyleVars({ "editorGutter.background": gutBg });
        app.render();

        const backend = app.backend;
        // All gutter columns (0..5) should have gutBg
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
        // Content starts at gutterWidth = 6
        expect(backend.getBgAt(new Point(6, 0))).toBe(editorBg);
        expect(backend.getBgAt(new Point(7, 0))).toBe(editorBg);
    });

    it("uses editor resolved style fg for text", () => {
        const editorFg = packRgb(212, 212, 212);
        const { app, editor } = createEditor("Hi", 15, 3);
        editor.style = { fg: editorFg };
        app.render();

        const backend = app.backend;
        // "H" at column 6 (gutterWidth)
        expect(backend.getFgAt(new Point(6, 0))).toBe(editorFg);
    });

    it("defaults gutter bg to editor bg when gutterBackground is not set", () => {
        const editorBg = packRgb(40, 40, 40);
        const { app, editor } = createEditor("Hi", 15, 3);
        editor.style = { bg: editorBg };
        app.render();

        const backend = app.backend;
        // Gutter columns should inherit editor background
        expect(backend.getBgAt(new Point(0, 0))).toBe(editorBg);
        expect(backend.getBgAt(new Point(2, 0))).toBe(editorBg);
    });

    it("uses default line number colors when not explicitly set", () => {
        const { app } = createEditor("AAA\nBBB", 15, 4);
        app.render();

        const backend = app.backend;
        const defaultLnFg = packRgb(133, 133, 133);
        const defaultLnActiveFg = packRgb(198, 198, 198);

        // Row 0 is active (cursor at line 0) → active color
        expect(backend.getFgAt(new Point(2, 0))).toBe(defaultLnActiveFg);
        // Row 1 is not active → default line number color
        expect(backend.getFgAt(new Point(2, 1))).toBe(defaultLnFg);
    });
});

// ─── Content area ───────────────────────────────────────────

describe("content area rendering", () => {
    it("renders text content after gutter", () => {
        const { app } = createEditor("Hello World", 20, 3);
        app.render();

        const backend = app.backend;
        // gutterWidth = 6, content starts at 6
        expect(backend.getTextAt(new Point(6, 0), 11)).toBe("Hello World");
    });

    it("fills remaining space with spaces for short lines", () => {
        const { app } = createEditor("Hi", 12, 2);
        app.render();

        const backend = app.backend;
        // gutterWidth = 6, content area = 6 cols
        // "Hi" takes 2 chars, rest should be spaces
        expect(backend.getTextAt(new Point(6, 0), 6)).toBe("Hi    ");
    });

    it("handles empty document", () => {
        const { app } = createEditor("", 12, 3);
        app.render();

        const backend = app.backend;
        // Line 0: "  1   " gutter + empty content
        expect(backend.getTextAt(new Point(0, 0), 6)).toBe("  1   ");
        // Past end: fully blank, no tildes
        expect(backend.getTextAt(new Point(6, 1), 1)).toBe(" ");
    });

    it("correctly shows selection background in content area", () => {
        const selBg = packRgb(38, 79, 120);
        const { app, editor } = createEditor("Hello World", 20, 3);
        // Select "ello" (chars 1-5) by setting selection directly
        editor.viewState.selections = [{ anchor: { line: 0, character: 1 }, active: { line: 0, character: 5 } }];
        app.render();

        const backend = app.backend;
        // "ello" should have selection bg at columns 6+1..6+4 = 7,8,9,10
        expect(backend.getBgAt(new Point(7, 0))).toBe(selBg);
        expect(backend.getBgAt(new Point(8, 0))).toBe(selBg);
        expect(backend.getBgAt(new Point(9, 0))).toBe(selBg);
        expect(backend.getBgAt(new Point(10, 0))).toBe(selBg);
    });
});

// ─── Scrolling ──────────────────────────────────────────────

describe("scrolling", () => {
    const tenLines = Array.from({ length: 10 }, (_, i) => `Line${String(i + 1)}`).join("\n");

    describe("vertical scroll", () => {
        it("shows correct line numbers after scrolling down", () => {
            // 10 lines, viewport height = 4 → gutterWidth = 7 (2+2+3)
            const { app, editor } = createEditor(tenLines, 20, 4);
            editor.viewState.scrollTop = 3;
            app.render();

            const backend = app.backend;
            // Visible lines: 4,5,6,7 (0-indexed: 3,4,5,6)
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
            // gutterWidth = 7
            expect(backend.getTextAt(new Point(7, 0), 5)).toBe("Line4");
            expect(backend.getTextAt(new Point(7, 1), 5)).toBe("Line5");
        });

        it("shows blank rows when scrolled near end of document", () => {
            const { app, editor } = createEditor(tenLines, 20, 4);
            editor.viewState.scrollTop = 8;
            app.render();

            const backend = app.backend;
            // Lines 9,10 are visible + 2 rows past end
            expect(backend.getTextAt(new Point(0, 0), 7)).toBe("   9   ");
            expect(backend.getTextAt(new Point(0, 1), 7)).toBe("  10   ");
            // Past end — fully blank gutter + content, no tildes
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
            // Cursor on line 5, scroll to show it
            editor.viewState.selections = [{ anchor: { line: 5, character: 0 }, active: { line: 5, character: 0 } }];
            editor.viewState.scrollTop = 3;
            app.render();

            const backend = app.backend;
            // Line 5 is at screenY=2 (scrollTop=3, line5 is viewLine=5, screenY=5-3=2)
            // Digit column = 2 (GUTTER_LEFT_PADDING)
            expect(backend.getFgAt(new Point(2, 2))).toBe(lnActiveFg);
            // Line 4 at screenY=0 is not active
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
            // Content shifts: scrollLeft=3, so first visible char at docChar=3 → "D"
            expect(backend.getTextAt(new Point(6, 0), 6)).toBe("DEFGHI");
        });

        it("gutter is not affected by horizontal scroll", () => {
            const { app, editor } = createEditor("ABCDEFGHIJKLMNOP", 12, 2);
            editor.viewState.scrollLeft = 5;
            app.render();

            const backend = app.backend;
            // Gutter still shows "  1   " regardless of horizontal scroll
            expect(backend.getTextAt(new Point(0, 0), 6)).toBe("  1   ");
        });

        it("fills with spaces when scrolled past line content", () => {
            const { app, editor } = createEditor("Hi", 12, 2);
            // gutterWidth = 6, contentCols = 6
            editor.viewState.scrollLeft = 1;
            app.render();

            const backend = app.backend;
            // "Hi" with scrollLeft=1 → visible char at docChar=1 is "i", then spaces
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
            // Line numbers: 5,6,7
            expect(backend.getTextAt(new Point(0, 0), 7)).toBe("   5   ");
            expect(backend.getTextAt(new Point(0, 1), 7)).toBe("   6   ");
            // Content of line 5 ("ABCDEFGH_5") scrollLeft=2 → "CDEFGH_5"
            expect(backend.getTextAt(new Point(7, 0), 8)).toBe("CDEFGH_5");
        });
    });
});
