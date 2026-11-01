import { describe, expect, it } from "vitest";

import { createDeleteEdit, createInsertEdit } from "../core/iTextEdit.ts";
import type { IInlineInsertion } from "../model/iInlineInsertion.ts";
import { TextDocument } from "../model/textDocument.ts";

import { LineBreaksCache } from "./lineBreaksCache.ts";

const WIDTH = 10;
// Lines with DISTINCT wrap layouts: a cache shift that lost its position would
// substitute someone else's result — and identity/value checks catch it.
const ONE_BREAK = "x".repeat(15); // → [10]
const TWO_BREAKS = "aaaa bbbb cccc dddd eeee"; // → [10, 20]

describe("LineBreaksCache", () => {
    it("returns breaks for a wrapping line and null for one that fits", () => {
        const doc = new TextDocument(`short\n${TWO_BREAKS}`);
        const cache = new LineBreaksCache(doc, 4, WIDTH);
        expect(cache.getBreaks(0)).toBeNull();
        expect(cache.getBreaks(1)).toEqual([10, 20]);
    });

    it("editing a line invalidates its breaks", () => {
        const doc = new TextDocument("aaaa bbbb cccc");
        const cache = new LineBreaksCache(doc, 4, WIDTH);
        expect(cache.getBreaks(0)).toEqual([10]);

        doc.applyEdits([createDeleteEdit(0, 4, 0, 14)]);
        expect(cache.getBreaks(0)).toBeNull();
    });

    it("inserting lines shifts the cache via splice at the exact position, leaving others untouched", () => {
        const doc = new TextDocument(`${ONE_BREAK}\nzz\n${TWO_BREAKS}\ntail`);
        const cache = new LineBreaksCache(doc, 4, WIDTH);
        const untouched = cache.getBreaks(0);
        const shifted = cache.getBreaks(2);
        expect(untouched).toEqual([10]);
        expect(cache.getBreaks(1)).toBeNull();
        expect(shifted).toEqual([10, 20]);
        expect(cache.getBreaks(3)).toBeNull();

        // Insert a line before "zz": TWO_BREAKS moves to line 3 —
        // as THE SAME array instance (shift without recompute); line 0 is untouched.
        doc.applyEdits([createInsertEdit(1, 0, "inserted\n")]);
        expect(cache.getBreaks(0)).toBe(untouched);
        expect(cache.getBreaks(3)).toBe(shifted);
        expect(cache.getBreaks(1)).toBeNull();
        expect(cache.getBreaks(2)).toBeNull();
    });

    it("deleting a line shrinks the cache via splice: entries below shift as the same instances", () => {
        const doc = new TextDocument(`aa\n${ONE_BREAK}\nzz\n${TWO_BREAKS}\ntail`);
        const cache = new LineBreaksCache(doc, 4, WIDTH);
        expect(cache.getBreaks(1)).toEqual([10]);
        const shifted = cache.getBreaks(3);
        expect(shifted).toEqual([10, 20]);

        doc.applyEdits([createDeleteEdit(1, 0, 2, 0)]);
        expect(cache.getBreaks(2)).toBe(shifted);
        expect(cache.getBreaks(0)).toBeNull();
        expect(cache.getBreaks(1)).toBeNull();
    });

    it("changing width resets the cache, repeating the same params is a no-op", () => {
        const doc = new TextDocument(TWO_BREAKS);
        const cache = new LineBreaksCache(doc, 4, WIDTH);
        expect(cache.getBreaks(0)).toEqual([10, 20]);

        cache.setParams(4, 14);
        const after = cache.getBreaks(0);
        expect(after).toEqual([15]);

        cache.setParams(4, 14);
        expect(cache.getBreaks(0)).toBe(after);

        cache.setParams(8, 14);
        expect(cache.getBreaks(0)).not.toBe(after);
        expect(cache.getBreaks(0)).toEqual([15]);
    });

    it("desync guard: document shrank behind the cache's back — value comes from the document, not the cache", () => {
        const doc = new TextDocument(`aa\nbb\n${ONE_BREAK}`);
        const cache = new LineBreaksCache(doc, 4, WIDTH);
        expect(cache.getBreaks(0)).toBeNull();

        // Simulate a missed event: an edit after the cache unsubscribed.
        cache.dispose();
        doc.applyEdits([createDeleteEdit(0, 0, 2, 0)]); // a single ONE_BREAK line remains
        // Without the guard a stale null from the former "aa" line would remain.
        expect(cache.getBreaks(0)).toEqual([10]);
    });

    it("desync guard survives a repeated shrink: reset rebuilds the cache to the document size", () => {
        const doc = new TextDocument(`aa\nbb\n${ONE_BREAK}`);
        const cache = new LineBreaksCache(doc, 4, WIDTH);
        expect(cache.getBreaks(0)).toBeNull();
        cache.dispose();

        doc.applyEdits([createDeleteEdit(0, 0, 1, 0)]); // [bb, ONE_BREAK]
        expect(cache.getBreaks(0)).toBeNull(); // "bb" — the first reset by the guard

        doc.applyEdits([createDeleteEdit(0, 0, 1, 0)]); // [ONE_BREAK]
        // The second desync is caught only if reset rebuilt the array sized to
        // the document, not empty.
        expect(cache.getBreaks(0)).toEqual([10]);
    });

    it("desync after a setParams reset: array is rebuilt to the document size", () => {
        const doc = new TextDocument(`aa\nbb\n${ONE_BREAK}`);
        const cache = new LineBreaksCache(doc, 4, WIDTH);
        cache.setParams(4, 14);
        expect(cache.getBreaks(0)).toBeNull();
        cache.dispose();

        doc.applyEdits([createDeleteEdit(0, 0, 2, 0)]); // [ONE_BREAK]
        expect(cache.getBreaks(0)).toEqual([14]);
    });
});

describe("LineBreaksCache.setInsertions", () => {
    const hint = { line: 0, offset: 4, text: ": int" };
    const other = { line: 0, offset: 6, text: "b=" };

    function withInsertions(...insertions: IInlineInsertion[]): LineBreaksCache {
        const cache = new LineBreaksCache(new TextDocument(`aaaa bbbb\n${ONE_BREAK}`), 4, WIDTH);
        cache.setInsertions(new Map([[0, insertions]]));
        return cache;
    }

    it("wraps the line by the composed text, and back when the insertion is gone", () => {
        const cache = withInsertions(hint);
        expect(cache.getBreaks(0)).toEqual([5]);
        expect(cache.setInsertions(new Map())).toBe(true);
        expect(cache.getBreaks(0)).toBeNull();
    });

    it("a line that gets its first insertion has changed", () => {
        const cache = new LineBreaksCache(new TextDocument("aaaa bbbb"), 4, WIDTH);
        expect(cache.getBreaks(0)).toBeNull();
        expect(cache.setInsertions(new Map([[0, [hint]]]))).toBe(true);
        expect(cache.getBreaks(0)).toEqual([5]);
    });

    it("the same cells in another look change nothing and keep the computed breaks", () => {
        const cache = withInsertions(hint, other);
        const breaks = cache.getBreaks(0);
        expect(cache.setInsertions(new Map([[0, [{ ...hint, italic: true }, { ...other }]]]))).toBe(false);
        expect(cache.getBreaks(0)).toBe(breaks);
    });

    it.each<[string, IInlineInsertion[]]>([
        ["the offset", [{ ...hint, offset: 3 }, other]],
        ["the text of the same length", [{ ...hint, text: ": str" }, other]],
        ["a later item", [hint, { ...other, text: "c=" }]],
        ["the count, one more", [hint, other, { line: 0, offset: 7, text: "c=" }]],
        ["the count, one less", [hint]],
    ])("a change of %s is a change", (_name, next) => {
        const cache = withInsertions(hint, other);
        expect(cache.setInsertions(new Map([[0, next]]))).toBe(true);
    });

    it("recomputes only the line that changed", () => {
        const cache = withInsertions(hint);
        const untouched = cache.getBreaks(1);
        cache.setInsertions(new Map([[0, [other]]]));
        expect(cache.getBreaks(1)).toBe(untouched);
    });
});
