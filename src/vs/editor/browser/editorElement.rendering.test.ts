import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

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

describe("tab rendering", () => {
    it("expands tab to spaces (tabSize=4)", () => {
        const { app, editor } = createEditor("a\tb", 20, 3);
        editor.tabSize = 4;
        app.render();

        const backend = app.backend;
        const gw = editor.gutterWidth;
        // The tab after "a" pads to tab stop 4: three spaces.
        expect(backend.getTextAt(new Point(gw, 0), 5)).toBe("a   b");
    });

    it("tab at beginning of line fills full tabSize columns", () => {
        const { app, editor } = createEditor("\tx", 20, 3);
        editor.tabSize = 4;
        app.render();

        const backend = app.backend;
        const gw = editor.gutterWidth;
        expect(backend.getTextAt(new Point(gw, 0), 5)).toBe("    x");
    });

    it("multiple tabs expand correctly", () => {
        const { app, editor } = createEditor("\t\tx", 20, 3);
        editor.tabSize = 4;
        app.render();

        const backend = app.backend;
        const gw = editor.gutterWidth;
        expect(backend.getTextAt(new Point(gw, 0), 9)).toBe("        x");
    });

    it("regression: all tab columns receive editor background (not just the first)", () => {
        // The tab used to be drawn as one setCell with width=4, but Grid knows only 1 and 2,
        // so columns 1–3 kept DEFAULT_COLOR.
        const EDITOR_BG = packRgb(30, 30, 46);
        const { app, editor } = createEditor("\tx", 20, 3);
        editor.tabSize = 4;
        editor.style = { bg: EDITOR_BG };
        app.render();

        const backend = app.backend;
        const gw = editor.gutterWidth;
        for (let i = 0; i < 4; i++) {
            expect(backend.getBgAt(new Point(gw + i, 0))).toBe(EDITOR_BG);
        }
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

describe("CJK rendering", () => {
    it("CJK character occupies 2 columns", () => {
        const { app, editor } = createEditor("a漢b", 20, 3);
        app.render();

        const backend = app.backend;
        const gw = editor.gutterWidth;
        // "a" is col. 0, "漢" is 1–2, "b" is 3.
        expect(backend.getTextAt(new Point(gw, 0), 1)).toBe("a");
        expect(backend.getTextAt(new Point(gw + 1, 0), 1)).toBe("漢");
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

describe("selection with special chars", () => {
    it("selection highlights correct display columns with tabs", () => {
        // Tab=4 → "    bc": characters 1..3 are columns 4..6.
        const { app, editor } = createEditor("\tbc", 20, 3);
        editor.tabSize = 4;
        editor.viewState.selections = [{ anchor: { line: 0, character: 1 }, active: { line: 0, character: 3 } }];
        app.render();

        const backend = app.backend;
        const gw = editor.gutterWidth;
        for (let x = 0; x < 4; x++) {
            expect(backend.getBgAt(new Point(gw + x, 0))).not.toBe(SELECTION_BG);
        }
        expect(backend.getBgAt(new Point(gw + 4, 0))).toBe(SELECTION_BG);
        expect(backend.getBgAt(new Point(gw + 5, 0))).toBe(SELECTION_BG);
    });

    it("selection highlights correct display columns with CJK", () => {
        const { app, editor } = createEditor("a漢b", 20, 3);
        editor.viewState.selections = [{ anchor: { line: 0, character: 1 }, active: { line: 0, character: 2 } }];
        app.render();

        const backend = app.backend;
        const gw = editor.gutterWidth;
        expect(backend.getBgAt(new Point(gw, 0))).not.toBe(SELECTION_BG);
        expect(backend.getBgAt(new Point(gw + 1, 0))).toBe(SELECTION_BG);
        expect(backend.getBgAt(new Point(gw + 2, 0))).toBe(SELECTION_BG);
        expect(backend.getBgAt(new Point(gw + 3, 0))).not.toBe(SELECTION_BG);
    });

    it("selecting a single tab highlights all 4 display columns", () => {
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
        // A tab at column 2 pads to stop 4, so it is 2 columns wide.
        const { app, editor } = createEditor("ab\tcd", 20, 3);
        editor.tabSize = 4;
        editor.viewState.selections = [{ anchor: { line: 0, character: 2 }, active: { line: 0, character: 3 } }];
        app.render();

        const backend = app.backend;
        const gw = editor.gutterWidth;
        expect(backend.getBgAt(new Point(gw, 0))).not.toBe(SELECTION_BG);
        expect(backend.getBgAt(new Point(gw + 1, 0))).not.toBe(SELECTION_BG);
        expect(backend.getBgAt(new Point(gw + 2, 0))).toBe(SELECTION_BG);
        expect(backend.getBgAt(new Point(gw + 3, 0))).toBe(SELECTION_BG);
        expect(backend.getBgAt(new Point(gw + 4, 0))).not.toBe(SELECTION_BG);
        expect(backend.getBgAt(new Point(gw + 5, 0))).not.toBe(SELECTION_BG);
    });

    it("selecting an emoji (2 code units) highlights its 2 display columns", () => {
        // "😀" is 2 code units (a surrogate pair) and 2 columns.
        const { app, editor } = createEditor("a😀b", 20, 3);
        editor.viewState.selections = [{ anchor: { line: 0, character: 1 }, active: { line: 0, character: 3 } }];
        app.render();

        const backend = app.backend;
        const gw = editor.gutterWidth;
        expect(backend.getBgAt(new Point(gw, 0))).not.toBe(SELECTION_BG);
        expect(backend.getBgAt(new Point(gw + 1, 0))).toBe(SELECTION_BG);
        expect(backend.getBgAt(new Point(gw + 2, 0))).toBe(SELECTION_BG);
        expect(backend.getBgAt(new Point(gw + 3, 0))).not.toBe(SELECTION_BG);
    });

    it("selecting from middle of line through tab highlights tab fully", () => {
        // The tab after "a" takes columns 1..3 up to stop 4.
        const { app, editor } = createEditor("a\tb", 20, 3);
        editor.tabSize = 4;
        editor.viewState.selections = [{ anchor: { line: 0, character: 0 }, active: { line: 0, character: 2 } }];
        app.render();

        const backend = app.backend;
        const gw = editor.gutterWidth;
        expect(backend.getBgAt(new Point(gw, 0))).toBe(SELECTION_BG);
        expect(backend.getBgAt(new Point(gw + 1, 0))).toBe(SELECTION_BG);
        expect(backend.getBgAt(new Point(gw + 2, 0))).toBe(SELECTION_BG);
        expect(backend.getBgAt(new Point(gw + 3, 0))).toBe(SELECTION_BG);
        expect(backend.getBgAt(new Point(gw + 4, 0))).not.toBe(SELECTION_BG);
    });
});

describe("cursor positioning with special chars", () => {
    it("cursor after tab is at correct display column", () => {
        const { app, editor } = createEditor("\tx", 20, 3);
        editor.tabSize = 4;
        editor.viewState.selections = [{ anchor: { line: 0, character: 1 }, active: { line: 0, character: 1 } }];
        editor.focus();
        app.render();

        const gw = editor.gutterWidth;
        const cursor = app.backend.cursorPosition;
        expect(cursor).not.toBeNull();
        expect(cursor.x).toBe(gw + 4);
    });

    it("cursor after CJK char is at correct display column", () => {
        const { app, editor } = createEditor("漢x", 20, 3);
        editor.viewState.selections = [{ anchor: { line: 0, character: 1 }, active: { line: 0, character: 1 } }];
        editor.focus();
        app.render();

        const gw = editor.gutterWidth;
        const cursor = app.backend.cursorPosition;
        expect(cursor).not.toBeNull();
        expect(cursor.x).toBe(gw + 2);
    });
});

describe("contentWidth with special chars", () => {
    it("accounts for tab expansion in contentWidth", () => {
        const { editor } = createEditor("\tabcd");
        editor.tabSize = 4;
        expect(editor.contentWidth).toBe(8);
    });

    it("accounts for CJK width in contentWidth", () => {
        const { editor } = createEditor("a漢b");
        expect(editor.contentWidth).toBe(4);
    });
});

describe("wide char at viewport edge", () => {
    it("wide char that doesn't fit at right edge is replaced with space", () => {
        const { app, editor } = createEditor("ab漢", 10, 3); // gw=6, contentCols=4
        // "漢" fits at columns 2–3.
        app.render();

        const backend = app.backend;
        const gw = editor.gutterWidth;
        expect(backend.getTextAt(new Point(gw + 2, 0), 1)).toBe("漢");

        // width=9: contentCols=3, but "漢" needs columns 2–3.
        const { app: app2, editor: editor2 } = createEditor("ab漢", 9, 3); // gw=6, contentCols=3
        app2.render();

        const backend2 = app2.backend;
        const gw2 = editor2.gutterWidth;
        expect(backend2.getTextAt(new Point(gw2, 0), 2)).toBe("ab");
        expect(backend2.getTextAt(new Point(gw2 + 2, 0), 1)).toBe(" ");
    });
});

describe("carriage return handling", () => {
    it("\\r does not affect display", () => {
        const { app, editor } = createEditor("abc\r", 20, 3);
        app.render();

        const backend = app.backend;
        const gw = editor.gutterWidth;
        expect(backend.getTextAt(new Point(gw, 0), 4)).toBe("abc ");
    });
});

describe("horizontal scroll with wide chars", () => {
    it("scrollLeft into middle of a wide char shows space placeholder", () => {
        // scrollLeft=1 lands on the continuation column of "漢": a space instead of half a glyph.
        const { app, editor } = createEditor("漢abc", 20, 3);
        editor.viewState.scrollLeft = 1;
        app.render();

        const backend = app.backend;
        const gw = editor.gutterWidth;
        expect(backend.getTextAt(new Point(gw, 0), 1)).toBe(" ");
        expect(backend.getTextAt(new Point(gw + 1, 0), 3)).toBe("abc");
    });
});
