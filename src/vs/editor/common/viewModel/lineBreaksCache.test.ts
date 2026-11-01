import { describe, expect, it } from "vitest";

import { createDeleteEdit, createInsertEdit } from "../core/iTextEdit.ts";
import { TextDocument } from "../model/textDocument.ts";

import { LineBreaksCache } from "./lineBreaksCache.ts";
import type { LineInsertions } from "./lineInsertions.ts";

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

describe("LineBreaksCache — insertions", () => {
    const insertionsOn = (line: number, offset: number, text: string): LineInsertions =>
        new Map([[line, [{ line, offset, text }]]]);

    it("a changed line recomputes with its insertions; removing them brings the old breaks back", () => {
        const cache = new LineBreaksCache(new TextDocument("aaaa bbbb\ncccc dddd"), 4, 10);
        expect(cache.getBreaks(0)).toBeNull();
        expect(cache.setInsertions(insertionsOn(0, 5, "xxxx"))).toBe(true);
        expect(cache.getBreaks(0)).toEqual([5]);
        expect(cache.getBreaks(1)).toBeNull();
        expect(cache.setInsertions(new Map())).toBe(true);
        expect(cache.getBreaks(0)).toBeNull();
        cache.dispose();
    });

    it.each([
        ["the same", 5, "xxxx", false],
        ["another offset", 6, "xxxx", true],
        ["another text", 5, "yyyy", true],
    ])("%s insertion reports a change: %s", (_name, offset, text, changed) => {
        const cache = new LineBreaksCache(new TextDocument("aaaa bbbb"), 4, 10);
        cache.setInsertions(insertionsOn(0, 5, "xxxx"));
        expect(cache.setInsertions(insertionsOn(0, offset, text))).toBe(changed);
        cache.dispose();
    });

    it("one of two insertions differing is a change, the same two are not", () => {
        const cache = new LineBreaksCache(new TextDocument("aaaa bbbb"), 4, 10);
        const two = (second: string): LineInsertions =>
            new Map([
                [
                    0,
                    [
                        { line: 0, offset: 5, text: "x" },
                        { line: 0, offset: 6, text: second },
                    ],
                ],
            ]);
        cache.setInsertions(two("y"));
        expect(cache.setInsertions(two("y"))).toBe(false);
        expect(cache.setInsertions(two("z"))).toBe(true);
        cache.dispose();
    });

    it("another count on a line is a change", () => {
        const cache = new LineBreaksCache(new TextDocument("aaaa bbbb"), 4, 10);
        cache.setInsertions(insertionsOn(0, 5, "x"));
        const two: LineInsertions = new Map([
            [
                0,
                [
                    { line: 0, offset: 5, text: "x" },
                    { line: 0, offset: 6, text: "y" },
                ],
            ],
        ]);
        expect(cache.setInsertions(two)).toBe(true);
        cache.dispose();
    });
});
