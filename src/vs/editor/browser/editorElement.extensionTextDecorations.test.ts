import { compositeOver, packRgb, packRgba } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createRange } from "../common/core/iRange.ts";
import { createSelection } from "../common/core/iSelection.ts";
import type { IExtensionTextDecoration } from "../common/model/iExtensionTextDecoration.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

const BG = packRgb(0x1f, 0x1f, 0x1f);
const FG = packRgb(0xcc, 0xcc, 0xcc);
const SELECTION_BG = packRgb(0x26, 0x4f, 0x78);
const FIND_MATCH_CURRENT_BG = packRgb(168, 109, 0);
/** Trailing Spaces' default `rgba(255,0,0,0.3)`. */
const TRAILING = packRgba(255, 0, 0, 77);
const MERGE = packRgba(0x40, 0xc8, 0xae, 0x33);

const WIDTH = 24;

function createEditor(text: string, decorations: readonly IExtensionTextDecoration[], wordWrap = false) {
    const viewState = new EditorViewState(new TextDocument(text));
    if (wordWrap) viewState.wordWrap = "on";
    const editor = new EditorElement(viewState);
    editor.occurrenceHighlightEnabled = false;
    editor.setStyleVars({
        "editor.background": BG,
        "editor.foreground": FG,
        "editor.selectionBackground": SELECTION_BG,
    });
    // The editor's own background: without it a translucent color over DEFAULT_COLOR loses its alpha.
    editor.style = { bg: "editor.background", fg: "editor.foreground" };
    editor.extensionTextDecorations = decorations;
    const app = TestApp.createWithContent(editor, new Size(WIDTH, 6));
    app.render();
    const gw = editor.gutterWidth;
    const bgAt = (col: number, row: number): number => app.backend.getBgAt(new Point(gw + col, row));
    const fgAt = (col: number, row: number): number => app.backend.getFgAt(new Point(gw + col, row));
    return { app, editor, viewState, gw, bgAt, fgAt };
}

describe("EditorElement — extension text decorations", () => {
    it("[api:TextEditor.setDecorations] a translucent range background composites over the editor background, once", () => {
        const { bgAt, app } = createEditor("alpha   \nbeta", [
            { range: createRange(0, 5, 0, 8), bg: TRAILING, isWholeLine: false },
        ]);

        const trailing = compositeOver(TRAILING, BG);
        expect([bgAt(4, 0), bgAt(5, 0), bgAt(6, 0), bgAt(7, 0), bgAt(8, 0)]).toStrictEqual([
            BG,
            trailing,
            trailing,
            trailing,
            BG,
        ]);
        expect(trailing).toBe(packRgb(0x63, 0x16, 0x16));
        // A repaint of the frame does not stack a second layer.
        app.render();
        expect(bgAt(5, 0)).toBe(trailing);
    });

    it("an empty range paints nothing; a range past the line end is cut to the text plus the newline cell", () => {
        const { bgAt } = createEditor("ab\ncd", [
            { range: createRange(0, 1, 0, 1), bg: TRAILING, isWholeLine: false },
            { range: createRange(1, 1, 1, 40), bg: TRAILING, isWholeLine: false },
        ]);

        expect(bgAt(1, 0)).toBe(BG);
        expect(bgAt(1, 1)).toBe(compositeOver(TRAILING, BG));
        expect(bgAt(2, 1)).toBe(compositeOver(TRAILING, BG));
        expect(bgAt(3, 1)).toBe(BG);
    });

    it("a multi-line range covers the first line from start and the last up to end", () => {
        const { bgAt } = createEditor("abcd\nefgh\nijkl", [
            { range: createRange(0, 2, 2, 1), bg: TRAILING, isWholeLine: false },
        ]);
        const painted = compositeOver(TRAILING, BG);

        expect([bgAt(1, 0), bgAt(2, 0), bgAt(4, 0)]).toStrictEqual([BG, painted, painted]);
        expect([bgAt(0, 1), bgAt(4, 1)]).toStrictEqual([painted, painted]);
        expect([bgAt(0, 2), bgAt(1, 2)]).toStrictEqual([painted, BG]);
    });

    it("isWholeLine fills every line of the range to the right edge of the text area, past the line end", () => {
        const { bgAt, gw } = createEditor("<<<\nmine\n===\ntheirs", [
            { range: createRange(1, 0, 1, 0), bg: MERGE, isWholeLine: true },
        ]);
        const merged = compositeOver(MERGE, BG);

        for (let col = 0; col < WIDTH - gw; col++) expect(bgAt(col, 1)).toBe(merged);
        expect(bgAt(0, 0)).toBe(BG);
        expect(bgAt(0, 2)).toBe(BG);
    });

    it("isWholeLine covers every wrapped row of the line", () => {
        const { bgAt, app, gw } = createEditor(
            "x\n" + "word ".repeat(10),
            [{ range: createRange(1, 0, 1, 0), bg: MERGE, isWholeLine: true }],
            true,
        );
        expect(app.backend.getTextAt(new Point(gw, 3), 4)).toBe("word");
        const merged = compositeOver(MERGE, BG);

        for (const row of [1, 2, 3]) {
            expect(bgAt(0, row)).toBe(merged);
            expect(bgAt(WIDTH - gw - 1, row)).toBe(merged);
        }
        expect(bgAt(0, 0)).toBe(BG);
    });

    it("color paints the glyphs of the range and keeps them; with isWholeLine only the line's glyphs", () => {
        const red = packRgb(255, 0, 0);
        const { fgAt, app, gw } = createEditor("abcd\nefgh", [
            { range: createRange(0, 1, 0, 3), fg: red, isWholeLine: false },
            { range: createRange(1, 2, 1, 2), fg: red, isWholeLine: true },
        ]);

        expect(app.backend.getTextAt(new Point(gw, 0), 4)).toBe("abcd");
        expect([fgAt(0, 0), fgAt(1, 0), fgAt(2, 0), fgAt(3, 0)]).toStrictEqual([FG, red, red, FG]);
        expect([fgAt(0, 1), fgAt(3, 1)]).toStrictEqual([red, red]);
    });

    it("later decorations paint over earlier ones: translucent ones stack, an opaque one wins", () => {
        const blue = packRgb(0, 0, 255);
        const { bgAt } = createEditor("abcdef", [
            { range: createRange(0, 0, 0, 4), bg: TRAILING, isWholeLine: false },
            { range: createRange(0, 2, 0, 6), bg: TRAILING, isWholeLine: false },
            { range: createRange(0, 5, 0, 6), bg: blue, isWholeLine: false },
        ]);

        expect(bgAt(0, 0)).toBe(compositeOver(TRAILING, BG));
        expect(bgAt(2, 0)).toBe(compositeOver(TRAILING, compositeOver(TRAILING, BG)));
        expect(bgAt(5, 0)).toBe(blue);
    });

    it("lies over the selection (seen through a translucent color) and under the current find match", () => {
        const { bgAt, viewState, app } = createEditor("alpha beta gamma", [
            { range: createRange(0, 0, 0, 16), bg: TRAILING, isWholeLine: false },
        ]);
        viewState.selections = [createSelection(0, 0, 0, 5)];
        viewState.searchMatches = [createRange(0, 6, 0, 10)];
        viewState.currentSearchMatchIndex = 0;
        app.render();

        expect(bgAt(1, 0)).toBe(compositeOver(TRAILING, SELECTION_BG));
        expect(bgAt(7, 0)).toBe(FIND_MATCH_CURRENT_BG);
        expect(bgAt(12, 0)).toBe(compositeOver(TRAILING, BG));
    });

    it("a wide character and a tab are covered by their display columns", () => {
        const { bgAt } = createEditor("a\t界b", [{ range: createRange(0, 1, 0, 3), bg: TRAILING, isWholeLine: false }]);
        const painted = compositeOver(TRAILING, BG);

        // Tab from column 1 to 4, the wide character on 4..5 (its glyph cell is 4), `b` on 6.
        expect([bgAt(0, 0), bgAt(1, 0), bgAt(3, 0), bgAt(4, 0), bgAt(6, 0)]).toStrictEqual([
            BG,
            painted,
            painted,
            painted,
            BG,
        ]);
    });

    it("thousands of ranges off the viewport leave the visible rows right", () => {
        const text = Array.from({ length: 10_000 }, () => "x  ").join("\n");
        const ranges = Array.from({ length: 10_000 }, (_, line) => ({
            range: createRange(line, 1, line, 3),
            bg: TRAILING,
            isWholeLine: false,
        }));
        const { bgAt, viewState, app } = createEditor(text, ranges);
        viewState.scrollTop = 5_000;
        app.render();

        expect(bgAt(0, 0)).toBe(BG);
        expect(bgAt(1, 0)).toBe(compositeOver(TRAILING, BG));
        expect(bgAt(2, 5)).toBe(compositeOver(TRAILING, BG));
    });
});
