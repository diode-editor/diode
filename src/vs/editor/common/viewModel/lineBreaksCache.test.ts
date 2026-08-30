import { describe, expect, it } from "vitest";

import { createDeleteEdit, createInsertEdit } from "../core/iTextEdit.ts";
import { TextDocument } from "../model/textDocument.ts";

import { LineBreaksCache } from "./lineBreaksCache.ts";

const WIDTH = 10;
// Строки с РАЗЛИЧИМЫМИ раскладками переносов: сдвиг кеша, потерявший позицию,
// подставит чужой результат — и идентичность/значение это поймают.
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

        // Строка укоротилась и теперь влезает.
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

        // Вставка строки перед "zz": TWO_BREAKS уезжает на строку 3 —
        // ТЕМ ЖЕ экземпляром массива (сдвиг без пересчёта); строка 0 не тронута.
        doc.applyEdits([createInsertEdit(1, 0, "inserted\n")]);
        expect(cache.getBreaks(0)).toBe(untouched);
        expect(cache.getBreaks(3)).toBe(shifted);
        expect(cache.getBreaks(1)).toBeNull(); // "inserted"
        expect(cache.getBreaks(2)).toBeNull(); // "zz"
    });

    it("удаление строки усаживает кеш splice'ом: записи ниже сдвигаются тем же экземпляром", () => {
        const doc = new TextDocument(`aa\n${ONE_BREAK}\nzz\n${TWO_BREAKS}\ntail`);
        const cache = new LineBreaksCache(doc, 4, WIDTH);
        expect(cache.getBreaks(1)).toEqual([10]);
        const shifted = cache.getBreaks(3);
        expect(shifted).toEqual([10, 20]);

        // Удаляем строку 1 целиком: TWO_BREAKS поднимается на строку 2.
        doc.applyEdits([createDeleteEdit(1, 0, 2, 0)]);
        expect(cache.getBreaks(2)).toBe(shifted);
        expect(cache.getBreaks(0)).toBeNull(); // "aa"
        expect(cache.getBreaks(1)).toBeNull(); // "zz"
    });

    it("смена ширины сбрасывает кеш, повтор тех же параметров — no-op", () => {
        const doc = new TextDocument(TWO_BREAKS);
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
        const doc = new TextDocument(`aa\nbb\n${ONE_BREAK}`);
        const cache = new LineBreaksCache(doc, 4, WIDTH);
        expect(cache.getBreaks(0)).toBeNull();

        // Имитация пропущенного события: правка после отписки кеша.
        cache.dispose();
        doc.applyEdits([createDeleteEdit(0, 0, 2, 0)]); // остаётся одна строка ONE_BREAK
        // Без гарда осталось бы протухшее null от бывшей строки "aa".
        expect(cache.getBreaks(0)).toEqual([10]);
    });

    it("гард рассинхрона держит и повторное сжатие: reset пересобирает кеш по размеру документа", () => {
        const doc = new TextDocument(`aa\nbb\n${ONE_BREAK}`);
        const cache = new LineBreaksCache(doc, 4, WIDTH);
        expect(cache.getBreaks(0)).toBeNull();
        cache.dispose();

        doc.applyEdits([createDeleteEdit(0, 0, 1, 0)]); // [bb, ONE_BREAK]
        expect(cache.getBreaks(0)).toBeNull(); // "bb" — первый reset по гарду

        doc.applyEdits([createDeleteEdit(0, 0, 1, 0)]); // [ONE_BREAK]
        // Второй рассинхрон ловится, только если reset пересобрал массив по
        // размеру документа, а не пустым.
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
