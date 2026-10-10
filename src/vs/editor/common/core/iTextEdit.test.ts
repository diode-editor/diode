import { describe, expect, it } from "vitest";

import { createRange } from "./iRange.ts";
import {
    compareTextEditsInDocumentOrder,
    createDeleteEdit,
    createInsertEdit,
    createTextEdit,
    hasOverlappingEdits,
} from "./iTextEdit.ts";

/**
 * Непересечение правок в батче — условие контракта `applyEdits` документа.
 * Проверка стоит на входе от ненадёжного источника (правки расширения), и цена
 * ошибки в обе стороны высока: пропустить пересечение — тихо испортить текст,
 * увидеть его там, где его нет — отбить законный edit.
 */
describe("hasOverlappingEdits", () => {
    it("пустой батч и одна правка — не пересечение", () => {
        expect(hasOverlappingEdits([])).toBe(false);
        expect(hasOverlappingEdits([createDeleteEdit(0, 0, 0, 5)])).toBe(false);
    });

    it("правки в разных местах — не пересечение", () => {
        expect(hasOverlappingEdits([createDeleteEdit(0, 0, 0, 2), createDeleteEdit(1, 3, 1, 5)])).toBe(false);
    });

    it("порядок в батче не важен: правки приходят в любом", () => {
        // Тот же батч, что выше, но задом наперёд — документный порядок
        // восстанавливается сортировкой, а не приходит от вызывающего.
        expect(hasOverlappingEdits([createDeleteEdit(1, 3, 1, 5), createDeleteEdit(0, 0, 0, 2)])).toBe(false);
    });

    it("встык — не пересечение", () => {
        expect(hasOverlappingEdits([createDeleteEdit(0, 0, 0, 2), createDeleteEdit(0, 2, 0, 4)])).toBe(false);
    });

    it("две вставки нулевой ширины в одну точку — не пересечение", () => {
        expect(hasOverlappingEdits([createInsertEdit(1, 1, "p"), createInsertEdit(1, 1, "q")])).toBe(false);
    });

    it("наложение на одной строке — пересечение", () => {
        expect(hasOverlappingEdits([createDeleteEdit(0, 0, 0, 5), createDeleteEdit(0, 3, 0, 8)])).toBe(true);
    });

    it("наложение, отданное в обратном порядке, тоже видно", () => {
        expect(hasOverlappingEdits([createDeleteEdit(0, 3, 0, 8), createDeleteEdit(0, 0, 0, 5)])).toBe(true);
    });

    it("вставка внутрь чужого многострочного диапазона — пересечение", () => {
        expect(
            hasOverlappingEdits([
                createTextEdit(createRange(0, 1, 2, 1), "x"),
                createInsertEdit(1, 0, "y"),
                createDeleteEdit(3, 0, 3, 1),
            ]),
        ).toBe(true);
    });

    it("пересечение находится и в середине длинного батча", () => {
        // Первая пара законна, вторая — нет: цикл обязан дойти до конца.
        expect(
            hasOverlappingEdits([
                createDeleteEdit(0, 0, 0, 1),
                createDeleteEdit(1, 0, 1, 1),
                createDeleteEdit(2, 0, 2, 4),
                createDeleteEdit(2, 2, 2, 6),
            ]),
        ).toBe(true);
    });
});

describe("compareTextEditsInDocumentOrder", () => {
    it("сначала по началу, даже когда концы совпадают", () => {
        const replace = createTextEdit(createRange(0, 0, 0, 2), "X");
        const insertAtEnd = createTextEdit(createRange(0, 2, 0, 2), "Y");
        expect(compareTextEditsInDocumentOrder(replace, insertAtEnd)).toBeLessThan(0);
        expect(compareTextEditsInDocumentOrder(insertAtEnd, replace)).toBeGreaterThan(0);
    });

    it("при равных началах — по концу", () => {
        const insert = createTextEdit(createRange(0, 1, 0, 1), "X");
        const replace = createTextEdit(createRange(0, 1, 0, 3), "Y");
        expect(compareTextEditsInDocumentOrder(insert, replace)).toBeLessThan(0);
        expect(compareTextEditsInDocumentOrder(insert, insert)).toBe(0);
    });
});
