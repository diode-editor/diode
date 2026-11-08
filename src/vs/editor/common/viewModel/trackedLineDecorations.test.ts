import { describe, expect, it, vi } from "vitest";

import { createRange } from "../core/iRange.ts";
import { createTextEdit } from "../core/iTextEdit.ts";
import type { IGlyphMarginDecoration } from "../model/iGlyphMarginDecoration.ts";
import { TextDocument } from "../model/textDocument.ts";

import { TrackedLineDecorations } from "./trackedLineDecorations.ts";

function glyph(key: string, line: number): IGlyphMarginDecoration {
    return { key, line, glyph: "▷", colorToken: "testing.runAction" };
}

function setup(text: string) {
    const document = new TextDocument(text);
    const live = new Set<string>();
    const delta = document.deltaDecorations.bind(document);
    vi.spyOn(document, "deltaDecorations").mockImplementation((oldIds, added) => {
        for (const id of oldIds) live.delete(id);
        const ids = delta(oldIds, added);
        for (const id of ids) live.add(id);
        return ids;
    });
    const glyphs = new TrackedLineDecorations<IGlyphMarginDecoration>(document);
    const lines = (): Record<number, string> =>
        Object.fromEntries([...glyphs.byLine()].map(([line, decoration]) => [line, decoration.key]));
    const edit = (startLine: number, startChar: number, endLine: number, endChar: number, text = ""): void => {
        document.applyEdits([createTextEdit(createRange(startLine, startChar, endLine, endChar), text)]);
    };
    return { document, glyphs, live, lines, edit };
}

describe("TrackedLineDecorations", () => {
    it("a glyph placed on another line leaves no decoration behind in the document", () => {
        const { glyphs, live, lines } = setup("a\nb\nc\nd");
        glyphs.set([glyph("x", 1), glyph("y", 2)]);
        glyphs.set([glyph("x", 3), glyph("y", 2)]);
        expect(lines()).toEqual({ 2: "y", 3: "x" });
        expect(live.size).toBe(2);

        glyphs.set([]);
        expect(live.size).toBe(0);
        expect(glyphs.isEmpty).toBe(true);
    });

    it("a line break typed at the start of a glyph's line takes the glyph down with the text", () => {
        const { glyphs, lines, edit } = setup("a\nit b\nc");
        glyphs.set([glyph("x", 1)]);
        edit(1, 0, 1, 0, "\n");
        expect(lines()).toEqual({ 2: "x" });
    });

    it("deleting an empty line in the middle takes its glyph along", () => {
        const { glyphs, lines, edit } = setup("a\n\nc");
        glyphs.set([glyph("a", 0), glyph("x", 1)]);
        edit(1, 0, 2, 0);
        expect(lines()).toEqual({ 0: "a" });
    });

    it("deleting the last line takes its glyph along", () => {
        const { glyphs, lines, edit } = setup("a\nit b");
        glyphs.set([glyph("x", 0), glyph("y", 1)]);
        edit(0, 1, 1, 4);
        expect(lines()).toEqual({ 0: "x" });
    });
});
