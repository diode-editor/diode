import { describe, expect, it, vi } from "vitest";

import { createDeleteEdit, createInsertEdit } from "../core/iTextEdit.ts";
import { TextDocument } from "../model/textDocument.ts";

import { LineWidthCache } from "./lineWidthCache.ts";

describe("LineWidthCache", () => {
    it("reports the widest line", () => {
        const doc = new TextDocument("a\nbbbb\ncc");
        const cache = new LineWidthCache(doc, 4);
        expect(cache.getMaxWidth()).toBe(4);
    });

    it("empty document has width 0", () => {
        const doc = new TextDocument("");
        const cache = new LineWidthCache(doc, 4);
        expect(cache.getMaxWidth()).toBe(0);
    });

    it("accounts for tab expansion", () => {
        const doc = new TextDocument("\tx"); // tab (4) + x = 5
        const cache = new LineWidthCache(doc, 4);
        expect(cache.getMaxWidth()).toBe(5);
    });

    it("accounts for CJK width", () => {
        const doc = new TextDocument("日本"); // 2 wide chars = 4 cols
        const cache = new LineWidthCache(doc, 4);
        expect(cache.getMaxWidth()).toBe(4);
    });

    it("caps an extreme line at the render threshold, not its length", () => {
        const doc = new TextDocument("z".repeat(1_000_000));
        const cache = new LineWidthCache(doc, 4);
        expect(cache.getMaxWidth()).toBe(10_000);
    });

    it("repeated calls without edits are stable", () => {
        const doc = new TextDocument("hello\nworld!!");
        const cache = new LineWidthCache(doc, 4);
        expect(cache.getMaxWidth()).toBe(7);
        expect(cache.getMaxWidth()).toBe(7);
    });

    it("grows the max when a longer line is inserted", () => {
        const doc = new TextDocument("a\nb");
        const cache = new LineWidthCache(doc, 4);
        expect(cache.getMaxWidth()).toBe(1);

        doc.applyEdits([createInsertEdit(1, 1, "\nlongerline")]);
        expect(cache.getMaxWidth()).toBe(10);
    });

    it("shrinks the max when the widest line is deleted", () => {
        const doc = new TextDocument("short\nthis is the widest line\nx");
        const cache = new LineWidthCache(doc, 4);
        expect(cache.getMaxWidth()).toBe(23);

        // Delete the whole middle line (including its trailing newline).
        doc.applyEdits([createDeleteEdit(1, 0, 2, 0)]);
        expect(cache.getMaxWidth()).toBe(5);
    });

    it("updates the max when a line is edited in place", () => {
        const doc = new TextDocument("aa\nbb");
        const cache = new LineWidthCache(doc, 4);
        expect(cache.getMaxWidth()).toBe(2);

        doc.applyEdits([createInsertEdit(0, 2, "aaaaaa")]);
        expect(cache.getMaxWidth()).toBe(8);
    });

    it("appending a line only re-measures the changed lines (Output panel pattern)", () => {
        const doc = new TextDocument("line0");
        const cache = new LineWidthCache(doc, 4);
        cache.getMaxWidth(); // prime every line

        const getLineContent = vi.spyOn(doc, "getLineContent");
        // Simulate one appended log record.
        doc.applyEdits([createInsertEdit(0, 5, "\nline1")]);
        cache.getMaxWidth();

        // Only the two lines touched by the edit are re-measured, not the whole
        // document — this is what stops the freeze under active RPC tracing.
        const measuredLines = new Set(getLineContent.mock.calls.map((c) => c[0]));
        expect(measuredLines.size).toBeLessThanOrEqual(2);
    });

    it("does not re-measure anything when nothing changed", () => {
        const doc = new TextDocument("a\nbb\nccc");
        const cache = new LineWidthCache(doc, 4);
        cache.getMaxWidth();

        const getLineContent = vi.spyOn(doc, "getLineContent");
        cache.getMaxWidth();
        cache.getMaxWidth();
        expect(getLineContent).not.toHaveBeenCalled();
    });

    it("invalidates all widths when the tab size changes", () => {
        const doc = new TextDocument("\tx"); // one tab + x
        const cache = new LineWidthCache(doc, 4);
        expect(cache.getMaxWidth()).toBe(5); // tab→4 + x

        cache.setTabSize(8);
        expect(cache.getMaxWidth()).toBe(9); // tab→8 + x
    });

    it("setTabSize with the same value is a no-op (no re-measure)", () => {
        const doc = new TextDocument("\tx");
        const cache = new LineWidthCache(doc, 4);
        expect(cache.getMaxWidth()).toBe(5);

        const getLineContent = vi.spyOn(doc, "getLineContent");
        cache.setTabSize(4); // unchanged → must not invalidate
        expect(cache.getMaxWidth()).toBe(5);
        expect(getLineContent).not.toHaveBeenCalled();
    });

    it("stops listening after dispose", () => {
        const doc = new TextDocument("a\nb");
        const cache = new LineWidthCache(doc, 4);
        expect(cache.getMaxWidth()).toBe(1);

        cache.dispose();
        doc.applyEdits([createInsertEdit(1, 1, "\nlongerline")]);
        // Stale by design: the disposed cache no longer tracks the document.
        expect(cache.getMaxWidth()).toBe(1);
    });

    it("clamps to the document length if it shrank behind the cache's back", () => {
        // A render scheduled via setImmediate can fire after the document shrank.
        // Detach the cache from events (dispose) to force that desync, then shrink
        // the document: getMaxWidth must clamp to the current length, not read
        // past it and throw.
        const doc = new TextDocument("aa\nbbbb\ncccccc");
        const cache = new LineWidthCache(doc, 4);
        expect(cache.getMaxWidth()).toBe(6); // widths array now has 3 entries

        cache.dispose(); // stop tracking; the array stays at length 3
        doc.setText("z"); // document is now a single short line

        expect(() => cache.getMaxWidth()).not.toThrow();
        expect(cache.getMaxWidth()).toBe(1);
    });
});
