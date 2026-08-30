import { describe, expect, it } from "vitest";

import { createDeleteEdit, createInsertEdit } from "../core/iTextEdit.ts";
import { TextDocument } from "../model/textDocument.ts";

import { LineBreaksCache } from "./lineBreaksCache.ts";

const WIDTH = 10;

describe("LineBreaksCache", () => {
    it("отдаёт breaks переносимой строки и null — влезающей", () => {
        const doc = new TextDocument("short\naaaa bbbb cccc");
        const cache = new LineBreaksCache(doc, 4, WIDTH);
        expect(cache.getBreaks(0)).toBeNull();
        expect(cache.getBreaks(1)).toEqual([10]);
    });

    it("правка строки инвалидирует её breaks", () => {
        const doc = new TextDocument("aaaa bbbb cccc");
        const cache = new LineBreaksCache(doc, 4, WIDTH);
        expect(cache.getBreaks(0)).toEqual([10]);

        // Строка укоротилась и теперь влезает.
        doc.applyEdits([createDeleteEdit(0, 4, 0, 14)]);
        expect(cache.getBreaks(0)).toBeNull();
    });

    it("вставка строк сдвигает кеш splice'ом: непричастная строка не пересчитывается", () => {
        const doc = new TextDocument(`${"a".repeat(15)}\nzz`);
        const cache = new LineBreaksCache(doc, 4, WIDTH);
        const first = cache.getBreaks(0);
        expect(first).toEqual([10]);

        doc.applyEdits([createInsertEdit(1, 0, "inserted\n")]);
        // Тот же экземпляр массива — строка 0 пережила splice без пересчёта.
        expect(cache.getBreaks(0)).toBe(first);
        expect(cache.getBreaks(1)).toBeNull(); // "inserted"
        expect(cache.getBreaks(2)).toBeNull(); // "zz"
    });

    it("удаление строк усаживает кеш и инвалидирует изменённый диапазон", () => {
        const doc = new TextDocument(`aa\n${"b".repeat(15)}\ncc`);
        const cache = new LineBreaksCache(doc, 4, WIDTH);
        expect(cache.getBreaks(1)).toEqual([10]);

        doc.applyEdits([createDeleteEdit(0, 2, 1, 15)]); // склеить строки 0 и 1
        expect(cache.getBreaks(0)).toBeNull(); // "aa"
        expect(cache.getBreaks(1)).toBeNull(); // "cc"
    });

    it("смена ширины сбрасывает кеш, повтор тех же параметров — no-op", () => {
        const doc = new TextDocument("aaaa bbbb cccc dddd eeee");
        const cache = new LineBreaksCache(doc, 4, WIDTH);
        expect(cache.getBreaks(0)).toEqual([10, 20]);

        cache.setParams(4, 14);
        const after = cache.getBreaks(0);
        expect(after).toEqual([15]);

        // No-op: тот же экземпляр массива — кеш не сброшен.
        cache.setParams(4, 14);
        expect(cache.getBreaks(0)).toBe(after);

        // Смена tabSize — сброс (новый экземпляр).
        cache.setParams(8, 14);
        expect(cache.getBreaks(0)).not.toBe(after);
        expect(cache.getBreaks(0)).toEqual([15]);
    });

    it("гард рассинхрона: документ сжался мимо кеша — значение от документа, не из кеша", () => {
        const doc = new TextDocument(`aa\nbb\n${"c".repeat(15)}`);
        const cache = new LineBreaksCache(doc, 4, WIDTH);
        expect(cache.getBreaks(0)).toBeNull();
        expect(cache.getBreaks(2)).toEqual([10]);

        // Имитация пропущенного события: правка после отписки кеша.
        cache.dispose();
        doc.applyEdits([createDeleteEdit(0, 0, 2, 0)]); // остаётся одна строка из "c"
        // Без гарда осталось бы протухшее null от бывшей строки "aa".
        expect(cache.getBreaks(0)).toEqual([10]);
    });
});
