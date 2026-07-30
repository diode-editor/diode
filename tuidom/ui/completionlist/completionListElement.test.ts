import { describe, expect, it } from "vitest";

import { renderElement } from "../../../src/TestUtils/renderElement.ts";
import { packRgb } from "../../common/colorUtils.ts";
import { Point, Size } from "../../common/geometryPromitives.ts";
import { TUIMouseEvent } from "../../dom/events/tuiMouseEvent.ts";

import type { CompletionListItem } from "./completionListElement.ts";
import { CompletionListElement, unthemedCompletionListStyles } from "./completionListElement.ts";

function makeWidget(items: CompletionListItem[]): CompletionListElement {
    const w = new CompletionListElement();
    w.setItems(items);
    return w;
}

const ITEMS: CompletionListItem[] = [
    { label: "indent_style", kind: 9, data: 1 },
    { label: "indent_size", kind: 9, data: 2 },
    { label: "insert_final_newline", kind: 4, data: 3 },
];

function mouse(w: CompletionListElement, type: "mousemove" | "click", localY: number): void {
    w.dispatchEvent(new TUIMouseEvent(type, { button: "left", screenX: 0, screenY: localY, localX: 5, localY }));
}

function renderToString(w: CompletionListElement): string {
    return renderElement(w, w.getMaxIntrinsicWidth(0), w.getMaxIntrinsicHeight(0)).screenToString();
}

describe("CompletionListElement", () => {
    it("показывает все элементы без фильтра", () => {
        const w = makeWidget(ITEMS);
        expect(w.items).toHaveLength(3);
        expect(w.getSelectedItem()?.label).toBe("indent_style");
    });

    it("не забирает фокус (focusable=false)", () => {
        const w = makeWidget(ITEMS);
        expect(w.focusable).toBe(false);
    });

    it("фильтрует по подстроке (case-insensitive)", () => {
        const w = makeWidget(ITEMS);
        w.setFilter("IND");
        expect(w.items.map((i) => i.label)).toEqual(["indent_style", "indent_size"]);
        w.setFilter("final");
        expect(w.items.map((i) => i.label)).toEqual(["insert_final_newline"]);
    });

    it("setFilter начисто сворачивает список до нуля при отсутствии совпадений", () => {
        const w = makeWidget(ITEMS);
        w.setFilter("zzzz");
        expect(w.items).toHaveLength(0);
    });

    it("refineFilter оставляет последний непустой список при нуле совпадений", () => {
        const w = makeWidget(ITEMS);
        w.refineFilter("ind");
        expect(w.items.map((i) => i.label)).toEqual(["indent_style", "indent_size"]);
        w.refineFilter("indz"); // ничего не матчит — держим прошлый непустой
        expect(w.items.map((i) => i.label)).toEqual(["indent_style", "indent_size"]);
        w.refineFilter("indent_s"); // снова совпадает — обновляем
        expect(w.items.map((i) => i.label)).toEqual(["indent_style", "indent_size"]);
    });

    it("selectNext/Previous двигают выбор с clamp (без wrap)", () => {
        const w = makeWidget(ITEMS);
        w.selectPrevious(); // уже на 0 — остаётся
        expect(w.selectedIndex).toBe(0);
        w.selectNext();
        w.selectNext();
        expect(w.getSelectedItem()?.label).toBe("insert_final_newline");
        w.selectNext(); // clamp на последнем
        expect(w.selectedIndex).toBe(2);
    });

    it("клик по ряду выбирает и принимает пункт", () => {
        const w = makeWidget(ITEMS);
        let accepted: CompletionListItem | null = null;
        w.onAccept = (item) => {
            accepted = item;
        };
        mouse(w, "click", 2); // ряд 0 — верхняя рамка; localY=2 → второй пункт
        expect(w.selectedIndex).toBe(1);
        expect(accepted).not.toBeNull();
        expect(accepted!.data).toBe(2);
    });

    it("наведение подсвечивает ряд без принятия", () => {
        const w = makeWidget(ITEMS);
        let accepted = false;
        w.onAccept = () => {
            accepted = true;
        };
        mouse(w, "mousemove", 3); // третий пункт
        expect(w.selectedIndex).toBe(2);
        expect(accepted).toBe(false);
    });

    it("наведение на рамку или на уже выбранный ряд — no-op", () => {
        const w = makeWidget(ITEMS);
        mouse(w, "mousemove", 0); // верхняя рамка → index null
        expect(w.selectedIndex).toBe(0);
        mouse(w, "mousemove", 1); // ряд 0 — уже выбран → без изменений
        expect(w.selectedIndex).toBe(0);
    });

    it("клик по рамке — no-op", () => {
        const w = makeWidget(ITEMS);
        let accepted = false;
        w.onAccept = () => {
            accepted = true;
        };
        mouse(w, "click", 0); // верхняя рамка
        expect(accepted).toBe(false);
    });

    it("mousedown не фокусит (focusable=false)", () => {
        const w = makeWidget(ITEMS);
        w.dispatchEvent(
            new TUIMouseEvent("mousedown", { button: "left", screenX: 0, screenY: 1, localX: 5, localY: 1 }),
        );
        expect(w.isFocused).toBe(false);
    });

    it("рендерится с рамкой (углы ╭╮╰╯, как у остальных оверлеев)", () => {
        const w = makeWidget(ITEMS);
        const size = new Size(w.getMaxIntrinsicWidth(0), w.getMaxIntrinsicHeight(0));
        const backend = renderElement(w, size.width, size.height);
        expect(backend.getTextAt(new Point(0, 0), 1)).toBe("╭");
        expect(backend.getTextAt(new Point(size.width - 1, 0), 1)).toBe("╮");
        expect(backend.getTextAt(new Point(0, size.height - 1), 1)).toBe("╰");
        expect(backend.getTextAt(new Point(size.width - 1, size.height - 1), 1)).toBe("╯");
        // Метка первого элемента присутствует на первом ряду.
        expect(backend.screenToString()).toContain("indent_style");
    });

    it("подсветка выбранного ряда не залезает на боковые рамки", () => {
        const w = makeWidget(ITEMS); // выбран ряд 0
        const size = new Size(w.getMaxIntrinsicWidth(0), w.getMaxIntrinsicHeight(0));
        const backend = renderElement(w, size.width, size.height);
        const selRow = 1; // первый пункт (выбран)
        const innerSelected = backend.getBgAt(new Point(5, selRow)); // фон выделения (область метки)
        const leftBorder = backend.getBgAt(new Point(0, selRow));
        const rightBorder = backend.getBgAt(new Point(size.width - 1, selRow));
        // Рамка выбранного ряда сохраняет фон попапа, а не фон выделения.
        expect(leftBorder).not.toBe(innerSelected);
        expect(rightBorder).not.toBe(innerSelected);
        // И совпадает с рамкой невыбранного ряда.
        expect(leftBorder).toBe(backend.getBgAt(new Point(0, selRow + 1)));
    });

    it("min и max intrinsic-размеры совпадают (self-sizing)", () => {
        const w = makeWidget(ITEMS);
        expect(w.getMinIntrinsicWidth(0)).toBe(w.getMaxIntrinsicWidth(0));
        expect(w.getMinIntrinsicHeight(0)).toBe(w.getMaxIntrinsicHeight(0));
    });

    it("рисует detail справа (выбранный и невыбранный ряд), длинный label усекается", () => {
        const w = makeWidget([
            { label: "x".repeat(60), detail: "Prop", kind: 9, data: 1 },
            { label: "size", detail: "Prop2", kind: 9, data: 2 },
        ]);
        const out = renderToString(w);
        expect(out).toContain("Prop"); // detail выбранного ряда
        expect(out).toContain("Prop2"); // detail невыбранного ряда (DETAIL_FG)
        expect(out).not.toContain("x".repeat(60)); // label усечён по ширине бокса
    });

    it("не рисует detail, если он не влезает", () => {
        const w = makeWidget([{ label: "ab", detail: "very-long-detail-text-here", kind: 9, data: 1 }]);
        w.preferredWidth = 16;
        const out = renderToString(w);
        expect(out).not.toContain("very-long-detail-text-here");
        expect(out).toContain("ab");
    });

    it("скроллит окно при навигации вниз и обратно вверх", () => {
        const many = Array.from({ length: 15 }, (_, i) => ({ label: `item${i}`, data: i }));
        const w = makeWidget(many);
        w.maxVisibleItems = 5;
        for (let i = 0; i < 9; i++) w.selectNext(); // до index 9 — окно уехало вниз
        expect(w.selectedIndex).toBe(9);
        expect(renderToString(w)).toContain("item9");
        for (let i = 0; i < 9; i++) w.selectPrevious(); // назад к 0 — окно вверх
        expect(w.selectedIndex).toBe(0);
        expect(renderToString(w)).toContain("item0");
    });

    it("page-навигация двигает на видимое окно", () => {
        const many = Array.from({ length: 15 }, (_, i) => ({ label: `item${i}`, data: i }));
        const w = makeWidget(many);
        w.maxVisibleItems = 5;
        w.selectNextPage();
        expect(w.selectedIndex).toBe(5);
        w.selectPreviousPage();
        expect(w.selectedIndex).toBe(0);
    });

    it("пустой список: getSelectedItem null, навигация/клик — no-op", () => {
        const w = makeWidget(ITEMS);
        w.setFilter("zzzz"); // ничего не матчит
        expect(w.items).toHaveLength(0);
        expect(w.getSelectedItem()).toBeNull();
        let accepted = false;
        w.onAccept = () => {
            accepted = true;
        };
        w.selectNext(); // moveSelection на пустом — return
        mouse(w, "click", 1); // ряд вне пунктов — без accept
        expect(accepted).toBe(false);
    });

    it("клик без назначенного onAccept не падает", () => {
        const w = makeWidget(ITEMS); // onAccept === null
        expect(() => {
            mouse(w, "click", 1);
        }).not.toThrow();
        expect(w.selectedIndex).toBe(0);
    });
});

describe("CompletionListElement — setStyles", () => {
    it("перекрашивает выбранный ряд и фон инжектированными цветами", () => {
        const w = makeWidget(ITEMS);
        w.setStyles({
            ...unthemedCompletionListStyles,
            activeSelectionBg: packRgb(9, 9, 9),
            bg: packRgb(1, 2, 3),
        });

        const backend = renderElement(w, w.getMaxIntrinsicWidth(0), w.getMaxIntrinsicHeight(0));

        // Ряд 1 — выбранный (index 0), ряд 2 — обычный.
        expect(backend.getBgAt(new Point(5, 1))).toBe(packRgb(9, 9, 9));
        expect(backend.getBgAt(new Point(5, 2))).toBe(packRgb(1, 2, 3));
    });
});
