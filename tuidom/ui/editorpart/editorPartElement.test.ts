import { describe, expect, it } from "vitest";

import { BoxConstraints, Offset, Point, Size } from "../../common/geometryPromitives.ts";
import { TUIMouseEvent } from "../../dom/events/tuiMouseEvent.ts";
import { TUIElement } from "../../dom/tuiElement.ts";

import { EditorPartElement, MIN_GROUP_MAIN_COLS } from "./editorPartElement.ts";

function panels(count: number): TUIElement[] {
    return Array.from({ length: count }, () => new TUIElement());
}

function layoutAt(part: EditorPartElement, width: number, height: number): void {
    part.localPosition = new Offset(0, 0);
    part.layout(BoxConstraints.tight(new Size(width, height)));
}

describe("EditorPartElement", () => {
    it("одна группа занимает всю полосу", () => {
        const part = new EditorPartElement();
        const [a] = panels(1);
        part.setViews([a]);
        layoutAt(part, 100, 30);

        expect(a.layoutSize).toEqual(new Size(100, 30));
        expect(a.localPosition).toEqual(new Offset(0, 0));
    });

    it("две группы делятся по весам, сумма размеров равна полосе", () => {
        const part = new EditorPartElement();
        const [a, b] = panels(2);
        part.setViews([a, b], [2, 1]);
        layoutAt(part, 90, 30);

        expect(a.layoutSize.width).toBe(60);
        expect(b.layoutSize.width).toBe(30);
        expect(b.localPosition).toEqual(new Offset(60, 0));
    });

    it("нечётная ширина раздаётся по наибольшим дробным остаткам без дыр", () => {
        const part = new EditorPartElement();
        const [a, b, c] = panels(3);
        part.setViews([a, b, c]);
        layoutAt(part, 100, 30);

        const widths = [a, b, c].map((p) => p.layoutSize.width);
        expect(widths.reduce((s, w) => s + w, 0)).toBe(100);
        expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
        expect(c.localPosition.dx).toBe(widths[0] + widths[1]);
    });

    it("min-кламп: узкая доля добирается до минимума за счёт широкой", () => {
        const part = new EditorPartElement();
        const [a, b] = panels(2);
        part.setViews([a, b], [99, 1]);
        layoutAt(part, 100, 30);

        expect(b.layoutSize.width).toBe(MIN_GROUP_MAIN_COLS);
        expect(a.layoutSize.width).toBe(100 - MIN_GROUP_MAIN_COLS);
    });

    it("полоса уже N×минимума — display-only равное деление, веса не мутируются", () => {
        const part = new EditorPartElement();
        const [a, b] = panels(2);
        part.setViews([a, b], [3, 1]);
        layoutAt(part, 30, 20);

        expect(a.layoutSize.width + b.layoutSize.width).toBe(30);
        // Веса пережили деградацию: широкая полоса вернёт пропорцию 3:1.
        layoutAt(part, 120, 20);
        expect(a.layoutSize.width).toBe(90);
        expect(b.layoutSize.width).toBe(30);
    });

    it("ряды: группы делят высоту, саш — поверх последней строки верхней", () => {
        const part = new EditorPartElement();
        const [a, b] = panels(2);
        part.setViews([a, b]);
        part.orientation = "rows";
        layoutAt(part, 80, 30);

        expect(a.layoutSize).toEqual(new Size(80, 15));
        expect(b.layoutSize).toEqual(new Size(80, 15));
        expect(b.localPosition).toEqual(new Offset(0, 15));
        // Саш лежит на последней строке ВЕРХНЕЙ группы, не на первой нижней —
        // та занята табами, и наложение отняло бы у них мышь.
        const sash = part.getChildren().find((c) => c.constructor.name === "SashElement")!;
        expect(sash.localPosition).toEqual(new Offset(0, 14));
    });

    it("саш лежит на границе групп и укладывается при каждом layout", () => {
        const part = new EditorPartElement();
        const [a, b] = panels(2);
        part.setViews([a, b]);
        layoutAt(part, 80, 30);

        const sash = part.getChildren().find((c) => c.constructor.name === "SashElement");
        expect(sash).toBeDefined();
        expect(sash!.localPosition).toEqual(new Offset(40, 0));
        expect(sash!.layoutSize).toEqual(new Size(1, 30));

        // Ресайз двигает границу — и саш обязан переехать (stale layoutSize ломает hit-test).
        layoutAt(part, 60, 30);
        expect(sash!.localPosition).toEqual(new Offset(30, 0));
    });

    it("вырожденная нулевая высота в rows — саш клампится в строку 0", () => {
        const part = new EditorPartElement();
        const [a, b] = panels(2);
        part.setViews([a, b]);
        part.orientation = "rows";
        layoutAt(part, 80, 0);

        const sash = part.getChildren().find((c) => c.constructor.name === "SashElement")!;
        expect(sash.localPosition).toEqual(new Offset(0, 0));
    });

    it("drag горизонтального саша в rows: курсор на строке Y — верхняя группа Y+1 строк", () => {
        const part = new EditorPartElement();
        const [a, b, c] = panels(3);
        part.setViews([a, b, c]);
        part.orientation = "rows";
        layoutAt(part, 80, 30);
        expect([a, b, c].map((v) => v.layoutSize.height)).toEqual([10, 10, 10]);

        const lower = part.getChildren().filter((ch) => ch.constructor.name === "SashElement")[1];
        expect(lower.localPosition).toEqual(new Offset(0, 19));
        lower.dispatchEvent(new TUIMouseEvent("mousedown", { button: "left", screenX: 5, screenY: 19, localX: 5, localY: 0 }));
        lower.dispatchEvent(new TUIMouseEvent("mousemove", { button: "left", screenX: 5, screenY: 24, localX: 5, localY: 0 }));
        lower.dispatchEvent(new TUIMouseEvent("mouseup", { button: "left", screenX: 5, screenY: 24, localX: 5, localY: 0 }));

        layoutAt(part, 80, 30);
        expect(b.layoutSize.height).toBe(15);
        expect(c.layoutSize.height).toBe(5);
    });

    it("drag саша перераспределяет веса пары и зовёт onDidChangeWeights", () => {
        const part = new EditorPartElement();
        const [a, b] = panels(2);
        part.setViews([a, b]);
        layoutAt(part, 100, 30);
        let fired = 0;
        part.onDidChangeWeights = () => fired++;

        const sash = part.getChildren().find((c) => c.constructor.name === "SashElement")!;
        sash.dispatchEvent(new TUIMouseEvent("mousedown", { button: "left", screenX: 50, screenY: 5, localX: 0, localY: 5 }));
        sash.dispatchEvent(new TUIMouseEvent("mousemove", { button: "left", screenX: 70, screenY: 5, localX: 0, localY: 5 }));
        sash.dispatchEvent(new TUIMouseEvent("mouseup", { button: "left", screenX: 70, screenY: 5, localX: 0, localY: 5 }));

        expect(fired).toBeGreaterThan(0);
        layoutAt(part, 100, 30);
        expect(a.layoutSize.width).toBe(70);
        expect(b.layoutSize.width).toBe(30);
    });

    it("drag саша упирается в минимум соседа", () => {
        const part = new EditorPartElement();
        const [a, b] = panels(2);
        part.setViews([a, b]);
        layoutAt(part, 100, 30);

        const sash = part.getChildren().find((c) => c.constructor.name === "SashElement")!;
        sash.dispatchEvent(new TUIMouseEvent("mousedown", { button: "left", screenX: 50, screenY: 5, localX: 0, localY: 5 }));
        sash.dispatchEvent(new TUIMouseEvent("mousemove", { button: "left", screenX: 99, screenY: 5, localX: 0, localY: 5 }));

        layoutAt(part, 100, 30);
        expect(b.layoutSize.width).toBe(MIN_GROUP_MAIN_COLS);
    });

    it("nudgeWeight растит группу за счёт соседа с клампом", () => {
        const part = new EditorPartElement();
        const [a, b] = panels(2);
        part.setViews([a, b]);
        layoutAt(part, 100, 30);

        part.nudgeWeight(0, 10);
        layoutAt(part, 100, 30);
        expect(a.layoutSize.width).toBe(60);
        expect(b.layoutSize.width).toBe(40);

        // Последняя группа растёт за счёт соседа слева.
        part.nudgeWeight(1, 5);
        layoutAt(part, 100, 30);
        expect(b.layoutSize.width).toBe(45);
    });

    it("evenWeights выравнивает доли", () => {
        const part = new EditorPartElement();
        const [a, b] = panels(2);
        part.setViews([a, b], [7, 1]);
        part.evenWeights();
        layoutAt(part, 100, 30);

        expect(a.layoutSize.width).toBe(50);
        expect(b.layoutSize.width).toBe(50);
    });

    it("максимизация: группа занимает всю полосу, остальные и саши скрыты", () => {
        const part = new EditorPartElement();
        const [a, b, c] = panels(3);
        part.setViews([a, b, c]);
        layoutAt(part, 90, 30);

        part.maximizedIndex = 1;
        layoutAt(part, 90, 30);

        expect(b.layoutSize).toEqual(new Size(90, 30));
        expect(b.localPosition).toEqual(new Offset(0, 0));
        expect(a.hidden).toBe(true);
        expect(c.hidden).toBe(true);
        expect(part.getChildren().filter((ch) => ch.constructor.name === "SashElement").every((s) => s.hidden)).toBe(
            true,
        );

        // Повторный тумблер возвращает полосу в прежних пропорциях.
        part.maximizedIndex = null;
        layoutAt(part, 90, 30);
        expect(a.hidden).toBe(false);
        expect(a.layoutSize.width).toBe(30);
    });

    it("canFit считает по текущему основному размеру", () => {
        const part = new EditorPartElement();
        const [a] = panels(1);
        part.setViews([a]);
        layoutAt(part, 45, 30);

        expect(part.canFit(2)).toBe(true); // 2×20 = 40 ≤ 45
        expect(part.canFit(3)).toBe(false); // 3×20 = 60 > 45
    });

    it("смена оси сохраняет веса", () => {
        const part = new EditorPartElement();
        const [a, b] = panels(2);
        part.setViews([a, b], [2, 1]);
        layoutAt(part, 90, 30);
        expect(a.layoutSize.width).toBe(60);

        part.orientation = "rows";
        layoutAt(part, 90, 30);
        expect(a.layoutSize).toEqual(new Size(90, 20));
        expect(b.layoutSize).toEqual(new Size(90, 10));
    });

    it("inspectState отдаёт ось, веса и максимизацию", () => {
        const part = new EditorPartElement();
        const [a, b] = panels(2);
        part.setViews([a, b], [1, 3]);

        expect(part.inspectState()).toEqual({
            orientation: "columns",
            weights: [0.25, 0.75],
            maximizedIndex: null,
            groupCount: 2,
        });
    });
});
