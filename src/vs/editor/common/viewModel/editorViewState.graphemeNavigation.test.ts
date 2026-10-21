import { describe, expect, it } from "vitest";

import { createCursorSelection } from "../core/iSelection.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

function createState(text: string, line = 0, character = 0): EditorViewState {
    const doc = new TextDocument(text);
    const state = new EditorViewState(doc, [createCursorSelection(line, character)]);
    return state;
}

describe("cursorRight — grapheme navigation", () => {
    it("skips entire emoji (surrogate pair)", () => {
        // The emoji is offsets 1-2.
        const state = createState("a😀b", 0, 1);
        state.cursorRight();
        expect(state.selections[0].active.character).toBe(3);
    });

    it("skips entire CJK character (single code unit)", () => {
        const state = createState("a漢b", 0, 1);
        state.cursorRight();
        expect(state.selections[0].active.character).toBe(2);
    });

    it("skips tab as single grapheme", () => {
        const state = createState("a\tb", 0, 1);
        state.cursorRight();
        expect(state.selections[0].active.character).toBe(2);
    });

    it("wraps to next line at end of line (no regression)", () => {
        const state = createState("abc\nxyz", 0, 3);
        state.cursorRight();
        expect(state.selections[0].active.line).toBe(1);
        expect(state.selections[0].active.character).toBe(0);
    });

    it("skips ZWJ emoji sequence as single grapheme", () => {
        // 👨‍👩‍👧 is a ZWJ sequence
        const emoji = "👨\u200D👩\u200D👧";
        const text = "a" + emoji + "b";
        const state = createState(text, 0, 1);
        state.cursorRight();
        expect(state.selections[0].active.character).toBe(1 + emoji.length);
    });
});

describe("cursorLeft — grapheme navigation", () => {
    it("skips entire emoji (surrogate pair) going left", () => {
        const state = createState("a😀b", 0, 3);
        state.cursorLeft();
        expect(state.selections[0].active.character).toBe(1);
    });

    it("skips CJK character going left", () => {
        const state = createState("a漢b", 0, 2);
        state.cursorLeft();
        expect(state.selections[0].active.character).toBe(1);
    });

    it("wraps to previous line at start (no regression)", () => {
        const state = createState("abc\nxyz", 1, 0);
        state.cursorLeft();
        expect(state.selections[0].active.line).toBe(0);
        expect(state.selections[0].active.character).toBe(3);
    });

    it("moves to last grapheme from end of line with emoji", () => {
        const state = createState("a😀", 0, 3);
        state.cursorLeft();
        expect(state.selections[0].active.character).toBe(1);
    });
});

describe("idealColumn — display column semantics", () => {
    it("cursorDown preserves display column through line with tab", () => {
        // "\tx": the tab is columns 0-3, "x" is column 4.
        const state = createState("abcdef\n\tx\nxyzwvuabcd", 0, 5);
        state.cursorDown();
        expect(state.selections[0].active.line).toBe(1);
        expect(state.selections[0].active.character).toBe(2);

        state.cursorDown();
        expect(state.selections[0].active.line).toBe(2);
        expect(state.selections[0].active.character).toBe(5);
    });

    it("cursorDown preserves display column through line with CJK", () => {
        // "漢字xyz": 漢 is columns 0-1, 字 is 2-3.
        const state = createState("abcdef\n漢字xyz\n0123456789", 0, 3);
        state.cursorDown();
        expect(state.selections[0].active.line).toBe(1);
        expect(state.selections[0].active.character).toBe(1);

        state.cursorDown();
        expect(state.selections[0].active.line).toBe(2);
        expect(state.selections[0].active.character).toBe(3);
    });
});

describe("ensureCursorVisible — display column scrolling", () => {
    it("scrollLeft adjusts based on display column with tabs", () => {
        const state = createState("\t\tx");
        state.tabSize = 4;
        state.viewportWidth = 5;
        state.viewportHeight = 10;
        state.selections = [createCursorSelection(0, 2)];
        state.cursorRight();
        expect(state.scrollLeft).toBeGreaterThan(0);
    });
});

describe("deleteLeft — grapheme-aware deletion", () => {
    it("deletes entire emoji with single backspace", () => {
        const state = createState("a😀b", 0, 3);
        state.deleteLeft();
        expect(state.document.getLineContent(0)).toBe("ab");
        expect(state.selections[0].active.character).toBe(1);
    });

    it("deletes entire CJK character with single backspace", () => {
        const state = createState("a漢b", 0, 2);
        state.deleteLeft();
        expect(state.document.getLineContent(0)).toBe("ab");
        expect(state.selections[0].active.character).toBe(1);
    });

    it("deletes tab with single backspace", () => {
        const state = createState("\tx", 0, 1);
        state.deleteLeft();
        expect(state.document.getLineContent(0)).toBe("x");
        expect(state.selections[0].active.character).toBe(0);
    });
});

describe("deleteRight — grapheme-aware deletion", () => {
    it("deletes entire emoji with single delete key", () => {
        const state = createState("a😀b", 0, 1);
        state.deleteRight();
        expect(state.document.getLineContent(0)).toBe("ab");
        expect(state.selections[0].active.character).toBe(1);
    });

    it("deletes entire CJK character with single delete key", () => {
        const state = createState("a漢b", 0, 1);
        state.deleteRight();
        expect(state.document.getLineContent(0)).toBe("ab");
        expect(state.selections[0].active.character).toBe(1);
    });

    it("deletes tab with single delete key", () => {
        const state = createState("a\tb", 0, 1);
        state.deleteRight();
        expect(state.document.getLineContent(0)).toBe("ab");
        expect(state.selections[0].active.character).toBe(1);
    });
});
