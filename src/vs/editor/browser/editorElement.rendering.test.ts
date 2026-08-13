import { describe, expect, it } from "vitest";

import { packRgb } from "@tuidom/all/common/colorUtils";
import { Point, Size } from "@tuidom/all/common/geometryPromitives";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

function createEditor(text: string, width = 30, height = 5): { app: TestApp; editor: EditorElement } {
    const doc = new TextDocument(text);
    const viewState = new EditorViewState(doc);
    const editor = new EditorElement(viewState);
    const app = TestApp.createWithContent(editor, new Size(width, height));
    return { app, editor };
}

const SELECTION_BG = packRgb(38, 79, 120);

// ─── Tab rendering ──────────────────────────────────────────

describe("tab rendering", () => {
    it("expands tab to spaces (tabSize=4)", () => {
        const { app, editor } = createEditor("a\tb", 20, 3);
        editor.tabSize = 4;
        app.render();

        const backend = app.backend;
        const gw = editor.gutterWidth;
        // "a" at gutter+0, tab expands to 3 spaces (4 - 1%4 = 3), then "b"
        expect(backend.getTextAt(new Point(gw, 0), 5)).toBe("a   b");
    });

    it("tab at beginning of line fills full tabSize columns", () => {
        const { app, editor } = createEditor("\tx", 20, 3);
        editor.tabSize = 4;
        app.render();

        const backend = app.backend;
        const gw = editor.gutterWidth;
        // tab at col 0 = 4 spaces, then "x"
        expect(backend.getTextAt(new Point(gw, 0), 5)).toBe("    x");
    });

    it("multiple tabs expand correctly", () => {
        const { app, editor } = createEditor("\t\tx", 20, 3);
        editor.tabSize = 4;
        app.render();

        const backend = app.backend;
        const gw = editor.gutterWidth;
        // Two tabs = 8 spaces, then "x"
        expect(backend.getTextAt(new Point(gw, 0), 9)).toBe("        x");
    });

    it("regression: all tab columns receive editor background (not just the first)", () => {
        // Before the fix, tab was rendered as a single setCell with width=4.
        // Grid/TerminalRenderer only support width=1 and width=2, so columns 1-3
        // of the tab were never written — they kept DEFAULT_COLOR background.
        const EDITOR_BG = packRgb(30, 30, 46);
        const { app, editor } = createEditor("\tx", 20, 3);
        editor.tabSize = 4;
        editor.style = { bg: EDITOR_BG };
        app.render();

        const backend = app.backend;
        const gw = editor.gutterWidth;
        // All 4 columns of the tab (cols 0-3) must have the editor background
        for (let i = 0; i < 4; i++) {
            expect(backend.getBgAt(new Point(gw + i, 0))).toBe(EDITOR_BG);
        }
        // "x" at col 4 also has editor background
        expect(backend.getBgAt(new Point(gw + 4, 0))).toBe(EDITOR_BG);
    });

    it("tabSize setting is shared between EditorElement and EditorViewState", () => {
        const { editor } = createEditor("\tx", 20, 3);
        editor.tabSize = 2;
        expect(editor.viewState.tabSize).toBe(2);
        editor.viewState.tabSize = 8;
        expect(editor.tabSize).toBe(8);
    });
});

// ─── CJK rendering ─────────────────────────────────────────

describe("CJK rendering", () => {
    it("CJK character occupies 2 columns", () => {
        const { app, editor } = createEditor("a漢b", 20, 3);
        app.render();

        const backend = app.backend;
        const gw = editor.gutterWidth;
        // "a" at col 0, "漢" at col 1-2, "b" at col 3
        expect(backend.getTextAt(new Point(gw, 0), 1)).toBe("a");
        expect(backend.getTextAt(new Point(gw + 1, 0), 1)).toBe("漢");
        // continuation at gw+2 is ""
        expect(backend.getTextAt(new Point(gw + 3, 0), 1)).toBe("b");
    });

    it("multiple CJK characters render correctly", () => {
        const { app, editor } = createEditor("漢字", 20, 3);
        app.render();

        const backend = app.backend;
        const gw = editor.gutterWidth;
        expect(backend.getTextAt(new Point(gw, 0), 1)).toBe("漢");
        expect(backend.getTextAt(new Point(gw + 2, 0), 1)).toBe("字");
    });
});

// ─── Emoji rendering ────────────────────────────────────────

describe("emoji rendering", () => {
    it("emoji occupies 2 columns", () => {
        const { app, editor } = createEditor("a😀b", 20, 3);
        app.render();

        const backend = app.backend;
        const gw = editor.gutterWidth;
        expect(backend.getTextAt(new Point(gw, 0), 1)).toBe("a");
        expect(backend.getTextAt(new Point(gw + 1, 0), 1)).toBe("😀");
        expect(backend.getTextAt(new Point(gw + 3, 0), 1)).toBe("b");
    });
});

// ─── Selection with tabs ────────────────────────────────────

describe("selection with special chars", () => {
    it("selection highlights correct display columns with tabs", () => {
        // text: "\tbc"  (tab=4 → display: "    bc")
        // select chars 1..3 → "bc" → display cols 4..6
        const { app, editor } = createEditor("\tbc", 20, 3);
        editor.tabSize = 4;
        editor.viewState.selections = [{ anchor: { line: 0, character: 1 }, active: { line: 0, character: 3 } }];
        app.render();

        const backend = app.backend;
        const gw = editor.gutterWidth;
        // Tab columns (0..3) should NOT have selection bg
        for (let x = 0; x < 4; x++) {
            expect(backend.getBgAt(new Point(gw + x, 0))).not.toBe(SELECTION_BG);
        }
        // "bc" columns (4..5) should have selection bg
        expect(backend.getBgAt(new Point(gw + 4, 0))).toBe(SELECTION_BG);
        expect(backend.getBgAt(new Point(gw + 5, 0))).toBe(SELECTION_BG);
    });

    it("selection highlights correct display columns with CJK", () => {
        // text: "a漢b", select chars 1..2 → "漢" → display cols 1..3
        const { app, editor } = createEditor("a漢b", 20, 3);
        editor.viewState.selections = [{ anchor: { line: 0, character: 1 }, active: { line: 0, character: 2 } }];
        app.render();

        const backend = app.backend;
        const gw = editor.gutterWidth;
        // "a" at col 0 — no selection
        expect(backend.getBgAt(new Point(gw, 0))).not.toBe(SELECTION_BG);
        // "漢" occupies cols 1-2 — selection
        expect(backend.getBgAt(new Point(gw + 1, 0))).toBe(SELECTION_BG);
        expect(backend.getBgAt(new Point(gw + 2, 0))).toBe(SELECTION_BG);
        // "b" at col 3 — no selection
        expect(backend.getBgAt(new Point(gw + 3, 0))).not.toBe(SELECTION_BG);
    });

    it("selecting a single tab highlights all 4 display columns", () => {
        // text: "\tx" → display "    x", selecting char 0..1 (the tab) → display cols 0..4
        const { app, editor } = createEditor("\tx", 20, 3);
        editor.tabSize = 4;
        editor.viewState.selections = [{ anchor: { line: 0, character: 0 }, active: { line: 0, character: 1 } }];
        app.render();

        const backend = app.backend;
        const gw = editor.gutterWidth;
        // All 4 tab-expanded columns must be highlighted
        for (let x = 0; x < 4; x++) {
            expect(backend.getBgAt(new Point(gw + x, 0))).toBe(SELECTION_BG);
        }
        // "x" at col 4 must NOT be highlighted
        expect(backend.getBgAt(new Point(gw + 4, 0))).not.toBe(SELECTION_BG);
    });

    it("selecting a tab in the middle of a line highlights only its expanded columns", () => {
        // text: "ab\tcd" — tab starts at col 2 and expands to col 4 (2 columns wide)
        // selecting char 2..3 (the tab) → display cols 2..4
        const { app, editor } = createEditor("ab\tcd", 20, 3);
        editor.tabSize = 4;
        editor.viewState.selections = [{ anchor: { line: 0, character: 2 }, active: { line: 0, character: 3 } }];
        app.render();

        const backend = app.backend;
        const gw = editor.gutterWidth;
        // "ab" at cols 0..1 — no selection
        expect(backend.getBgAt(new Point(gw, 0))).not.toBe(SELECTION_BG);
        expect(backend.getBgAt(new Point(gw + 1, 0))).not.toBe(SELECTION_BG);
        // tab spans cols 2..3 — selection
        expect(backend.getBgAt(new Point(gw + 2, 0))).toBe(SELECTION_BG);
        expect(backend.getBgAt(new Point(gw + 3, 0))).toBe(SELECTION_BG);
        // "cd" at cols 4..5 — no selection
        expect(backend.getBgAt(new Point(gw + 4, 0))).not.toBe(SELECTION_BG);
        expect(backend.getBgAt(new Point(gw + 5, 0))).not.toBe(SELECTION_BG);
    });

    it("selecting an emoji (2 code units) highlights its 2 display columns", () => {
        // text: "a😀b" — "😀" is 2 code units (surrogate pair) but 2 display columns
        // selecting char 1..3 (the emoji) → display cols 1..3
        const { app, editor } = createEditor("a😀b", 20, 3);
        editor.viewState.selections = [{ anchor: { line: 0, character: 1 }, active: { line: 0, character: 3 } }];
        app.render();

        const backend = app.backend;
        const gw = editor.gutterWidth;
        // "a" at col 0 — no selection
        expect(backend.getBgAt(new Point(gw, 0))).not.toBe(SELECTION_BG);
        // "😀" spans cols 1..2 — selection
        expect(backend.getBgAt(new Point(gw + 1, 0))).toBe(SELECTION_BG);
        expect(backend.getBgAt(new Point(gw + 2, 0))).toBe(SELECTION_BG);
        // "b" at col 3 — no selection
        expect(backend.getBgAt(new Point(gw + 3, 0))).not.toBe(SELECTION_BG);
    });

    it("selecting from middle of line through tab highlights tab fully", () => {
        // text: "a\tb" — tab spans cols 1..3 (3 cols to reach next tab stop at 4)
        // select chars 0..2 → "a" + tab → display cols 0..4
        const { app, editor } = createEditor("a\tb", 20, 3);
        editor.tabSize = 4;
        editor.viewState.selections = [{ anchor: { line: 0, character: 0 }, active: { line: 0, character: 2 } }];
        app.render();

        const backend = app.backend;
        const gw = editor.gutterWidth;
        // "a" at col 0 — selection
        expect(backend.getBgAt(new Point(gw, 0))).toBe(SELECTION_BG);
        // tab spans cols 1..3 — all selected
        expect(backend.getBgAt(new Point(gw + 1, 0))).toBe(SELECTION_BG);
        expect(backend.getBgAt(new Point(gw + 2, 0))).toBe(SELECTION_BG);
        expect(backend.getBgAt(new Point(gw + 3, 0))).toBe(SELECTION_BG);
        // "b" at col 4 — no selection
        expect(backend.getBgAt(new Point(gw + 4, 0))).not.toBe(SELECTION_BG);
    });
});

// ─── Cursor positioning ─────────────────────────────────────

describe("cursor positioning with special chars", () => {
    it("cursor after tab is at correct display column", () => {
        // text: "\tx", cursor at character 1 (the "x") → display col 4
        const { app, editor } = createEditor("\tx", 20, 3);
        editor.tabSize = 4;
        editor.viewState.selections = [{ anchor: { line: 0, character: 1 }, active: { line: 0, character: 1 } }];
        editor.focus();
        app.render();

        const gw = editor.gutterWidth;
        const cursor = app.backend.cursorPosition;
        expect(cursor).not.toBeNull();
        expect(cursor.x).toBe(gw + 4); // tab=4 cols, then cursor at col 4
    });

    it("cursor after CJK char is at correct display column", () => {
        // text: "漢x", cursor at character 1 (the "x") → display col 2
        const { app, editor } = createEditor("漢x", 20, 3);
        editor.viewState.selections = [{ anchor: { line: 0, character: 1 }, active: { line: 0, character: 1 } }];
        editor.focus();
        app.render();

        const gw = editor.gutterWidth;
        const cursor = app.backend.cursorPosition;
        expect(cursor).not.toBeNull();
        expect(cursor.x).toBe(gw + 2); // CJK=2 cols, cursor at col 2
    });
});

// ─── contentWidth ───────────────────────────────────────────

describe("contentWidth with special chars", () => {
    it("accounts for tab expansion in contentWidth", () => {
        const { editor } = createEditor("\tabcd");
        editor.tabSize = 4;
        // "\tabcd": tab=4 cols + 4 chars = 8
        expect(editor.contentWidth).toBe(8);
    });

    it("accounts for CJK width in contentWidth", () => {
        const { editor } = createEditor("a漢b");
        // "a"=1 + "漢"=2 + "b"=1 = 4
        expect(editor.contentWidth).toBe(4);
    });
});

// ─── Wide char at viewport edge ─────────────────────────────

describe("wide char at viewport edge", () => {
    it("wide char that doesn't fit at right edge is replaced with space", () => {
        // contentCols = width - gutterWidth. With width=7, gw=4, contentCols=3
        // text: "a漢" → display "a漢" needs cols 0,1,2 (3 cols) — fits
        // text: " 漢" → display " 漢" needs cols 0,1,2 (3 cols) — fits
        // But if we scroll so that only 2 cols remain for wide char, it should be replaced
        // Let's use a line where the wide char falls exactly at the edge
        const { app, editor } = createEditor("ab漢", 10, 3); // gw=6, contentCols=4
        // display: "ab漢 " = cols 0,1,2,3 — "漢" at cols 2-3, fits
        app.render();

        const backend = app.backend;
        const gw = editor.gutterWidth;
        expect(backend.getTextAt(new Point(gw + 2, 0), 1)).toBe("漢");

        // Now make viewport narrower so wide char doesn't fit
        // width=9, gw=6, contentCols=3 — "ab漢" = cols 0,1,2,3 — "漢" needs cols 2-3 but only 3 cols available (0,1,2)
        const { app: app2, editor: editor2 } = createEditor("ab漢", 9, 3); // gw=6, contentCols=3
        app2.render();

        const backend2 = app2.backend;
        const gw2 = editor2.gutterWidth;
        expect(backend2.getTextAt(new Point(gw2, 0), 2)).toBe("ab");
        // Wide char at col 2 can't fit (needs col 3 which doesn't exist) → space
        expect(backend2.getTextAt(new Point(gw2 + 2, 0), 1)).toBe(" ");
    });
});

// ─── \\r handling ────────────────────────────────────────────

describe("carriage return handling", () => {
    it("\\r does not affect display", () => {
        const { app, editor } = createEditor("abc\r", 20, 3);
        app.render();

        const backend = app.backend;
        const gw = editor.gutterWidth;
        expect(backend.getTextAt(new Point(gw, 0), 4)).toBe("abc ");
    });
});

// ─── Horizontal scroll with wide chars ──────────────────────

describe("horizontal scroll with wide chars", () => {
    it("scrollLeft into middle of a wide char shows space placeholder", () => {
        // text: "漢abc", display cols: 0=漢, 1=continuation, 2=a, 3=b, 4=c
        // scrollLeft=1 → first visible display col = 1 (continuation of 漢)
        // Should show space instead of partial wide char
        const { app, editor } = createEditor("漢abc", 20, 3);
        editor.viewState.scrollLeft = 1;
        app.render();

        const backend = app.backend;
        const gw = editor.gutterWidth;
        // First visible column should be a space (half of wide char)
        expect(backend.getTextAt(new Point(gw, 0), 1)).toBe(" ");
        // Then "a", "b", "c"
        expect(backend.getTextAt(new Point(gw + 1, 0), 3)).toBe("abc");
    });
});
