import { describe, expect, it } from "vitest";

import { Point, Rect, Size } from "../common/geometryPromitives.ts";

import { DamageList, MAX_DAMAGE_RECTS } from "./damage.ts";

const SCREEN = new Rect(new Point(0, 0), new Size(120, 40));

function rect(x: number, y: number, w: number, h: number): Rect {
    return new Rect(new Point(x, y), new Size(w, h));
}

describe("DamageList", () => {
    it("пустой rect игнорируется, isEmpty отражает состояние", () => {
        const list = new DamageList();
        expect(list.isEmpty).toBe(true);
        list.add(rect(3, 3, 0, 5));
        expect(list.isEmpty).toBe(true);
        list.add(rect(3, 3, 2, 2));
        expect(list.isEmpty).toBe(false);
    });

    it("вложенный rect поглощается существующим, накрывающий — заменяет", () => {
        const list = new DamageList();
        list.add(rect(10, 10, 20, 10));
        list.add(rect(12, 12, 5, 5)); // внутри
        expect(list.snapshot()).toHaveLength(1);
        list.add(rect(5, 5, 40, 30)); // накрывает
        expect(list.snapshot()).toHaveLength(1);
        expect(list.snapshot()[0]).toEqual(rect(5, 5, 40, 30));
    });

    it("finalize дилатирует ±1 колонку и клипует к экрану", () => {
        const list = new DamageList();
        list.add(rect(0, 0, 10, 5));
        const [out] = list.finalize(SCREEN);
        // Влево расти некуда (клип), вправо +1.
        expect(out).toEqual(rect(0, 0, 11, 5));
    });

    it("finalize сливает пересекающиеся (в т.ч. соприкоснувшиеся дилатацией)", () => {
        const list = new DamageList();
        list.add(rect(0, 0, 10, 5));
        list.add(rect(10, 0, 10, 5)); // впритык — дилатация даст пересечение
        const out = list.finalize(SCREEN);
        expect(out).toHaveLength(1);
        expect(out[0]).toEqual(rect(0, 0, 21, 5));
    });

    it("непересекающиеся области остаются раздельными", () => {
        const list = new DamageList();
        list.add(rect(0, 0, 10, 2)); // виджет
        list.add(rect(0, 39, 120, 1)); // статусбар
        const out = list.finalize(SCREEN);
        expect(out).toHaveLength(2);
    });

    it("кап: больше MAX_DAMAGE_RECTS областей сливаются с минимальным приростом площади", () => {
        const list = new DamageList();
        // MAX+1 раздельных областей: две рядом (дешёвое слияние), остальные далеко.
        list.add(rect(0, 0, 2, 1));
        list.add(rect(0, 2, 2, 1)); // близко к первой — минимальный прирост
        for (let i = 0; i < MAX_DAMAGE_RECTS - 1; i++) {
            list.add(rect(20 + i * 10, 20 + i * 2, 2, 1));
        }
        expect(list.snapshot().length).toBe(MAX_DAMAGE_RECTS + 1);
        const out = list.finalize(SCREEN);
        expect(out.length).toBeLessThanOrEqual(MAX_DAMAGE_RECTS);
        // Первая пара слита в одну колонку 0..2.
        expect(out.some((r) => r.x === 0 && r.height >= 3)).toBe(true);
    });
});
