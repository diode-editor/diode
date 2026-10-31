import { describe, expect, it, vi } from "vitest";

import { createDeleteEdit, createInsertEdit } from "../core/iTextEdit.ts";
import { TextDocument } from "../model/textDocument.ts";

import { LineWidthCache } from "./lineWidthCache.ts";
import { LONG_LINE_TRUNCATION_BADGE_WIDTH, STOP_RENDERING_LINE_AFTER } from "./longLineRendering.ts";

function measureAll(cache: LineWidthCache): void {
    while (cache.measurePending(1000)) {
        // until nothing is left
    }
}

function lineRange(first: number, last: number): number[] {
    return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

describe("LineWidthCache", () => {
    describe("measures on demand", () => {
        it("knows no width before any line is measured", () => {
            const doc = new TextDocument("a\nbbbb\ncc");
            const cache = new LineWidthCache(doc, 4);
            expect(cache.getMaxWidth()).toBe(0);
            expect(cache.hasUnmeasuredLines).toBe(true);
        });

        it("measureLines measures exactly the given lines and reports their maximum", () => {
            const doc = new TextDocument("a\nbbbb\ncc\ndddddddd");
            const cache = new LineWidthCache(doc, 4);
            const getLineContent = vi.spyOn(doc, "getLineContent");

            cache.measureLines([0, 1, 2]);

            expect(getLineContent.mock.calls.map((c) => c[0])).toEqual([0, 1, 2]);
            expect(cache.getMaxWidth()).toBe(4);
            expect(cache.hasUnmeasuredLines).toBe(true);
        });

        it("measureLines skips lines measured before", () => {
            const doc = new TextDocument("a\nbbbb\ncc");
            const cache = new LineWidthCache(doc, 4);
            cache.measureLines([0, 1]);

            const getLineContent = vi.spyOn(doc, "getLineContent");
            cache.measureLines([0, 1, 1, 2]);
            expect(getLineContent.mock.calls.map((c) => c[0])).toEqual([2]);
        });

        it("measurePending measures at most the budget, top to bottom, and says whether lines remain", () => {
            const doc = new TextDocument(
                lineRange(0, 9)
                    .map((i) => "x".repeat(i + 1))
                    .join("\n"),
            );
            const cache = new LineWidthCache(doc, 4);
            const getLineContent = vi.spyOn(doc, "getLineContent");

            expect(cache.measurePending(4)).toBe(true);
            expect(getLineContent.mock.calls.map((c) => c[0])).toEqual([0, 1, 2, 3]);
            expect(cache.getMaxWidth()).toBe(4);

            expect(cache.measurePending(4)).toBe(true);
            expect(cache.getMaxWidth()).toBe(8);

            expect(cache.measurePending(4)).toBe(false);
            expect(cache.getMaxWidth()).toBe(10);
            expect(cache.hasUnmeasuredLines).toBe(false);
            expect(getLineContent).toHaveBeenCalledTimes(10);
        });

        it("measurePending skips the lines a frame measured already", () => {
            const doc = new TextDocument("a\nbb\nccc\ndddd");
            const cache = new LineWidthCache(doc, 4);
            cache.measureLines([1, 2]);

            const getLineContent = vi.spyOn(doc, "getLineContent");
            measureAll(cache);
            expect(getLineContent.mock.calls.map((c) => c[0])).toEqual([0, 3]);
            expect(cache.getMaxWidth()).toBe(4);
        });

        it("reports the widest line once everything is measured", () => {
            const doc = new TextDocument("a\nbbbb\ncc");
            const cache = new LineWidthCache(doc, 4);
            measureAll(cache);
            expect(cache.getMaxWidth()).toBe(4);
        });

        it("empty document has width 0 and nothing left to measure", () => {
            const doc = new TextDocument("");
            const cache = new LineWidthCache(doc, 4);
            measureAll(cache);
            expect(cache.getMaxWidth()).toBe(0);
            expect(cache.hasUnmeasuredLines).toBe(false);
        });

        it("accounts for tab expansion", () => {
            const doc = new TextDocument("\tx"); // tab (4) + x = 5
            const cache = new LineWidthCache(doc, 4);
            measureAll(cache);
            expect(cache.getMaxWidth()).toBe(5);
        });

        it("accounts for CJK width", () => {
            const doc = new TextDocument("日本"); // 2 wide chars = 4 cols
            const cache = new LineWidthCache(doc, 4);
            measureAll(cache);
            expect(cache.getMaxWidth()).toBe(4);
        });

        it("caps an extreme line at the render threshold (plus the button), not its length", () => {
            const doc = new TextDocument("z".repeat(1_000_000));
            const cache = new LineWidthCache(doc, 4);
            measureAll(cache);
            expect(cache.getMaxWidth()).toBe(STOP_RENDERING_LINE_AFTER + LONG_LINE_TRUNCATION_BADGE_WIDTH);
        });

        it("a line exactly at the render threshold is not truncated and has no button", () => {
            const doc = new TextDocument("z".repeat(STOP_RENDERING_LINE_AFTER));
            const cache = new LineWidthCache(doc, 4);
            measureAll(cache);
            expect(cache.getMaxWidth()).toBe(STOP_RENDERING_LINE_AFTER);
        });

        it("does not re-measure anything when nothing changed", () => {
            const doc = new TextDocument("a\nbb\nccc");
            const cache = new LineWidthCache(doc, 4);
            measureAll(cache);

            const getLineContent = vi.spyOn(doc, "getLineContent");
            expect(cache.getMaxWidth()).toBe(3);
            expect(cache.getMaxWidth()).toBe(3);
            measureAll(cache);
            cache.measureLines([0, 1, 2]);
            expect(getLineContent).not.toHaveBeenCalled();
        });
    });

    describe("edits", () => {
        it("grows the max when a longer line is inserted and measured", () => {
            const doc = new TextDocument("a\nb");
            const cache = new LineWidthCache(doc, 4);
            measureAll(cache);
            expect(cache.getMaxWidth()).toBe(1);

            doc.applyEdits([createInsertEdit(1, 1, "\nlongerline")]);
            expect(cache.hasUnmeasuredLines).toBe(true);
            measureAll(cache);
            expect(cache.getMaxWidth()).toBe(10);
        });

        it("shrinks the max when the widest line is deleted, without measuring anything", () => {
            const doc = new TextDocument("short\nthis is the widest line\nx");
            const cache = new LineWidthCache(doc, 4);
            measureAll(cache);
            expect(cache.getMaxWidth()).toBe(23);

            doc.applyEdits([createDeleteEdit(1, 0, 2, 0)]);
            const getLineContent = vi.spyOn(doc, "getLineContent");
            expect(cache.getMaxWidth()).toBe(5);
            expect(getLineContent).not.toHaveBeenCalled();
        });

        it("shrinks the max when the widest line is removed below the edited one", () => {
            const doc = new TextDocument("a\nbb\nthe widest line");
            const cache = new LineWidthCache(doc, 4);
            measureAll(cache);
            expect(cache.getMaxWidth()).toBe(15);

            // Joins line 1 with line 2: line 2 is removed, line 1 is re-measured later.
            doc.applyEdits([createDeleteEdit(1, 0, 2, 0)]);
            expect(cache.getMaxWidth()).toBe(1);
        });

        it("keeps the max when one of two equally wide lines is deleted", () => {
            const doc = new TextDocument("aaaa\nc\nbbbb");
            const cache = new LineWidthCache(doc, 4);
            measureAll(cache);

            doc.applyEdits([createDeleteEdit(1, 0, 2, 0)]);
            expect(cache.getMaxWidth()).toBe(4);
        });

        it("shrinks the max when the widest line is edited shorter and re-measured", () => {
            const doc = new TextDocument("aa\nbbbbbb\ncc");
            const cache = new LineWidthCache(doc, 4);
            measureAll(cache);
            expect(cache.getMaxWidth()).toBe(6);

            doc.applyEdits([createDeleteEdit(1, 0, 1, 5)]);
            cache.measureLines([1]);
            expect(cache.getMaxWidth()).toBe(2);
        });

        it("grows the max when a line is edited wider in place", () => {
            const doc = new TextDocument("aa\nbb");
            const cache = new LineWidthCache(doc, 4);
            measureAll(cache);
            expect(cache.getMaxWidth()).toBe(2);

            doc.applyEdits([createInsertEdit(0, 2, "aaaaaa")]);
            cache.measureLines([0]);
            expect(cache.getMaxWidth()).toBe(8);
        });

        it("an edited line that is still the widest keeps the max exact", () => {
            const doc = new TextDocument("aaaa\nb");
            const cache = new LineWidthCache(doc, 4);
            measureAll(cache);

            doc.applyEdits([createInsertEdit(0, 4, "a")]);
            cache.measureLines([0]);
            expect(cache.getMaxWidth()).toBe(5);

            doc.applyEdits([createDeleteEdit(0, 4, 0, 5)]);
            cache.measureLines([0]);
            expect(cache.getMaxWidth()).toBe(4);
        });

        it("the sweep comes back for lines edited above its position", () => {
            const doc = new TextDocument("a\nb\nc\nd");
            const cache = new LineWidthCache(doc, 4);
            measureAll(cache);
            expect(cache.hasUnmeasuredLines).toBe(false);

            doc.applyEdits([createInsertEdit(0, 1, "aaaaa")]);
            expect(cache.hasUnmeasuredLines).toBe(true);
            const getLineContent = vi.spyOn(doc, "getLineContent");
            measureAll(cache);
            expect(getLineContent.mock.calls.map((c) => c[0])).toEqual([0]);
            expect(cache.getMaxWidth()).toBe(6);
        });

        it("appending a line only re-measures the changed lines (Output panel pattern)", () => {
            const doc = new TextDocument("line0");
            const cache = new LineWidthCache(doc, 4);
            measureAll(cache);

            const getLineContent = vi.spyOn(doc, "getLineContent");
            doc.applyEdits([createInsertEdit(0, 5, "\nline1")]);
            measureAll(cache);

            // Only the two touched lines are remeasured — this is what removes the freeze under RPC tracing.
            const measuredLines = new Set(getLineContent.mock.calls.map((c) => c[0]));
            expect(measuredLines.size).toBeLessThanOrEqual(2);
        });

        it("a deleted unmeasured line is just gone", () => {
            const doc = new TextDocument("aaaa\nbbbbbbbb\ncc");
            const cache = new LineWidthCache(doc, 4);
            cache.measureLines([0]);

            doc.applyEdits([createDeleteEdit(1, 0, 2, 0)]);
            expect(cache.getMaxWidth()).toBe(4);
            measureAll(cache);
            expect(cache.getMaxWidth()).toBe(4);
        });
    });

    describe("tab size", () => {
        it("invalidates all widths when the tab size changes", () => {
            const doc = new TextDocument("\tx");
            const cache = new LineWidthCache(doc, 4);
            measureAll(cache);
            expect(cache.getMaxWidth()).toBe(5); // tab→4 + x

            cache.setTabSize(8);
            expect(cache.hasUnmeasuredLines).toBe(true);
            measureAll(cache);
            expect(cache.getMaxWidth()).toBe(9); // tab→8 + x
        });

        it("setTabSize with the same value is a no-op (no re-measure)", () => {
            const doc = new TextDocument("\tx");
            const cache = new LineWidthCache(doc, 4);
            measureAll(cache);
            expect(cache.getMaxWidth()).toBe(5);

            const getLineContent = vi.spyOn(doc, "getLineContent");
            cache.setTabSize(4); // unchanged → must not invalidate
            expect(cache.hasUnmeasuredLines).toBe(false);
            expect(cache.getMaxWidth()).toBe(5);
            expect(getLineContent).not.toHaveBeenCalled();
        });
    });

    describe("lifecycle", () => {
        it("stops listening after dispose", () => {
            const doc = new TextDocument("a\nb");
            const cache = new LineWidthCache(doc, 4);
            measureAll(cache);
            expect(cache.getMaxWidth()).toBe(1);

            cache.dispose();
            doc.applyEdits([createInsertEdit(1, 1, "aaaa")]);
            // Stale value on purpose: a disposed cache doesn't track the document.
            expect(cache.hasUnmeasuredLines).toBe(false);
            expect(cache.getMaxWidth()).toBe(1);
        });

        // dispose detaches the cache from events — this reproduces the desync after the document shrinks.
        function desynced(): { doc: TextDocument; cache: LineWidthCache } {
            const doc = new TextDocument("aa\nbbbb\ncccccc");
            const cache = new LineWidthCache(doc, 4);
            measureAll(cache);
            expect(cache.getMaxWidth()).toBe(6);
            cache.dispose();
            doc.setText("z");
            return { doc, cache };
        }

        it("getMaxWidth rebuilds if the document changed its line count behind the cache's back", () => {
            const { cache } = desynced();
            expect(cache.getMaxWidth()).toBe(0);
            expect(cache.hasUnmeasuredLines).toBe(true);
            measureAll(cache);
            expect(cache.getMaxWidth()).toBe(1);
        });

        it("hasUnmeasuredLines sees the desync first", () => {
            const { cache } = desynced();
            expect(cache.hasUnmeasuredLines).toBe(true);
        });

        it("measureLines sees the desync first and its measurement counts", () => {
            const { cache } = desynced();
            cache.measureLines([0]);
            expect(cache.getMaxWidth()).toBe(1);
        });

        it("measurePending sees the desync first and its measurement counts", () => {
            const { cache } = desynced();
            expect(cache.measurePending(10)).toBe(false);
            expect(cache.getMaxWidth()).toBe(1);
        });
    });
});

describe("LineWidthCache — lines inserted in the middle", () => {
    it("the new line's width is unknown; the widths around it stay with their lines", () => {
        const doc = new TextDocument("a\nbbbb\ncc");
        const cache = new LineWidthCache(doc, 4);
        measureAll(cache);
        doc.applyEdits([createInsertEdit(0, 1, "\n")]);
        expect(cache.hasUnmeasuredLines).toBe(true);
        const getLineContent = vi.spyOn(doc, "getLineContent");

        cache.measureLines([0, 1, 2, 3]);

        expect(getLineContent.mock.calls.map((call) => call[0])).toEqual([0, 1]);
    });
});
