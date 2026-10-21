import { describe, expect, it } from "vitest";

import { createDeleteEdit, createInsertEdit } from "../core/iTextEdit.ts";
import { TextDocument } from "../model/textDocument.ts";

import { LineBreaksCache } from "./lineBreaksCache.ts";

const WIDTH = 10;
// Lines with DISTINCT wrap layouts: a cache shift that lost its position would
// substitute someone else's result — and identity/value checks catch it.
const ONE_BREAK = "x".repeat(15); // → [10]
const TWO_BREAKS = "aaaa bbbb cccc dddd eeee"; // → [10, 20]

describe("LineBreaksCache", () => {
    it("отдаёт breaks переносимой строки и null — влезающей", () => {
        const doc = new TextDocument(`short\n${TWO_BREAKS}`);
        const cache = new LineBreaksCache(doc, 4, WIDTH);
        expect(cache.getBreaks(0)).toBeNull();
        expect(cache.getBreaks(1)).toEqual([10, 20]);
    });

    it("правка строки инвалидирует её breaks", () => {
        const doc = new TextDocument("aaaa bbbb cccc");
        const cache = new LineBreaksCache(doc, 4, WIDTH);
        expect(cache.getBreaks(0)).toEqual([10]);

        doc.applyEdits([createDeleteEdit(0, 4, 0, 14)]);
        expect(cache.getBreaks(0)).toBeNull();
    });

    it("вставка строк сдвигает кеш splice'ом в точной позиции, не трогая непричастных", () => {
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

    it("удаление строки усаживает кеш splice'ом: записи ниже сдвигаются тем же экземпляром", () => {
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

    it("смена ширины сбрасывает кеш, повтор тех же параметров — no-op", () => {
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

    it("гард рассинхрона: документ сжался мимо кеша — значение от документа, не из кеша", () => {
        const doc = new TextDocument(`aa\nbb\n${ONE_BREAK}`);
        const cache = new LineBreaksCache(doc, 4, WIDTH);
        expect(cache.getBreaks(0)).toBeNull();

        // Simulate a missed event: an edit after the cache unsubscribed.
        cache.dispose();
        doc.applyEdits([createDeleteEdit(0, 0, 2, 0)]); // a single ONE_BREAK line remains
        // Without the guard a stale null from the former "aa" line would remain.
        expect(cache.getBreaks(0)).toEqual([10]);
    });

    it("гард рассинхрона держит и повторное сжатие: reset пересобирает кеш по размеру документа", () => {
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

    it("рассинхрон после setParams-сброса: массив пересобран по размеру документа", () => {
        const doc = new TextDocument(`aa\nbb\n${ONE_BREAK}`);
        const cache = new LineBreaksCache(doc, 4, WIDTH);
        cache.setParams(4, 14);
        expect(cache.getBreaks(0)).toBeNull();
        cache.dispose();

        doc.applyEdits([createDeleteEdit(0, 0, 2, 0)]); // [ONE_BREAK]
        expect(cache.getBreaks(0)).toEqual([14]);
    });
});
