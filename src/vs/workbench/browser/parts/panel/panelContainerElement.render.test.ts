import { packRgb } from "@tuidom/core/common/colorUtils";
import { BoxConstraints, Offset, Point, Rect, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { ROOT_STYLE_CONTEXT } from "@tuidom/core/dom/styles/tuiStyle";
import { RenderContext, TUIElement } from "@tuidom/core/dom/tuiElement";
import { TerminalScreen } from "@tuidom/core/rendering/terminalScreen";
import { describe, expect, it } from "vitest";

import { PanelContainerElement } from "./panelContainerElement.ts";

// Отрисовка панели — посимвольная, и проверять её надо на экране БОЛЬШЕ самой
// панели: тогда запись за её край видна как изменившаяся ячейка, а не пропадает
// в клипе. Панель живёт по смещению ORIGIN, экран — SCREEN.
const SCREEN = new Size(30, 8);
const ORIGIN = new Offset(2, 1);

const BG = packRgb(7, 8, 9);
const TITLE_FG = packRgb(44, 55, 66);
const BORDER = packRgb(70, 80, 90);
const CLOSE_FG = packRgb(101, 102, 103);
const HOVER_BG = packRgb(10, 20, 30);

const VARS = {
    "panel.background": BG,
    "panel.border": BORDER,
    "panelTitle.inactiveForeground": TITLE_FG,
    descriptionForeground: CLOSE_FG,
    "toolbar.hoverBackground": HOVER_BG,
};

/** Контент-заглушка: красит свою левую верхнюю ячейку, чтобы её было видно. */
class MarkerContent extends TUIElement {
    public constructor(private readonly marker: string) {
        super();
    }

    public override render(context: RenderContext): void {
        context.setCell(0, 0, { char: this.marker });
    }
}

function themed(): PanelContainerElement {
    const panel = new PanelContainerElement();
    panel.setStyleVars(VARS);
    return panel;
}

function paint(panel: PanelContainerElement, size: Size): TerminalScreen {
    const screen = new TerminalScreen(SCREEN);
    panel.localPosition = ORIGIN;
    panel.layout(BoxConstraints.tight(size));
    panel.performStyleResolution(ROOT_STYLE_CONTEXT);
    panel.render(new RenderContext(screen, ORIGIN, new Rect(new Point(0, 0), SCREEN)));
    return screen;
}

/** Ячейка экрана по координатам ВНУТРИ панели. */
function at(screen: TerminalScreen, x: number, y: number) {
    return screen.getCell(new Point(ORIGIN.dx + x, ORIGIN.dy + y));
}

/** Строка экрана по координатам внутри панели. */
function row(screen: TerminalScreen, y: number, from: number, length: number): string {
    return Array.from({ length }, (_, i) => at(screen, from + i, y).char).join("");
}

// Фикстура: "PROBLEMS" (8) → сегмент [1, 11), глифы 2..9; "OUT" (3) → [11, 16),
// глифы 12..14. Хвост таб-строки — 16; кнопка `×` на ширине 20 — колонки 17..19.
function twoTabs(): PanelContainerElement {
    const panel = themed();
    panel.addView({ id: "a", title: "PROBLEMS", content: null });
    panel.addView({ id: "b", title: "OUT", content: null });
    return panel;
}

describe("PanelContainerElement: отрисовка", () => {
    it("заливает фоном ровно свой прямоугольник и ни колонкой больше", () => {
        const screen = paint(twoTabs(), new Size(20, 5));

        // Углы панели залиты её фоном — включая последнюю строку и колонку.
        expect(at(screen, 0, 4).bg).toBe(BG);
        expect(at(screen, 19, 4).bg).toBe(BG);
        expect(at(screen, 19, 0).bg).toBe(BG);
        // Пустая ячейка внутри панели — пробел на её фоне, а не «никак».
        expect(at(screen, 5, 3).char).toBe(" ");
        expect(at(screen, 5, 3).bg).toBe(BG);
        // Соседи за краем — чужие, их панель не трогает.
        expect(at(screen, 20, 0).bg).not.toBe(BG);
        expect(at(screen, 0, 5).bg).not.toBe(BG);
    });

    it("рисует полосу верхней границы во всю ширину и только на нулевой строке", () => {
        const screen = paint(twoTabs(), new Size(20, 5));

        expect(row(screen, 0, 0, 20)).toBe("─".repeat(20));
        expect(at(screen, 0, 0).fg).toBe(BORDER);
        expect(at(screen, 19, 0).fg).toBe(BORDER);
        expect(at(screen, 20, 0).char).not.toBe("─");
        expect(at(screen, 0, 1).char).not.toBe("─");
    });

    it("отбивает названия вкладок пробелами ровно по одному с каждой стороны", () => {
        const screen = paint(twoTabs(), new Size(20, 5));

        expect(row(screen, 1, 0, 16)).toBe("  PROBLEMS  OUT ");
        // Отбивка — пробел с фоном панели, а не пустая ячейка.
        expect(at(screen, 1, 1).char).toBe(" ");
        expect(at(screen, 10, 1).char).toBe(" ");
        expect(at(screen, 2, 1).fg).toBe(TITLE_FG);
    });

    it("не красит таб-строку дальше последней вкладки", () => {
        const screen = paint(twoTabs(), new Size(20, 5));

        // Колонка 16 — сразу за хвостом таб-строки: её цвет остался от заливки
        // фоном, то есть НЕ цвет названий вкладок.
        expect(at(screen, 16, 1).fg).not.toBe(TITLE_FG);
        expect(at(screen, 16, 1).fg).toBe(at(screen, 5, 3).fg);
    });

    it("обрезает таб-строку по правому краю панели, не вылезая за него", () => {
        // Панель уже таб-строки: "PROBLEMS" занимает [1, 11), а панели всего 8.
        const screen = paint(twoTabs(), new Size(8, 4));

        expect(row(screen, 1, 0, 8)).toBe("  PRO × ");
        expect(at(screen, 8, 1).fg).not.toBe(TITLE_FG);
        expect(at(screen, 8, 1).bg).not.toBe(BG);
    });

    it("подчёркивает активную вкладку — только под глифами названия", () => {
        const panel = twoTabs();
        const screen = paint(panel, new Size(20, 5));

        // Активна первая: подчёркнуты её глифы и ничего кроме них.
        expect(at(screen, 2, 1).style).toBe(StyleFlags.Underline);
        expect(at(screen, 9, 1).style).toBe(StyleFlags.Underline);
        expect(at(screen, 1, 1).style).toBe(StyleFlags.None); // ведущая отбивка
        expect(at(screen, 10, 1).style).toBe(StyleFlags.None); // хвостовая отбивка
        expect(at(screen, 12, 1).style).toBe(StyleFlags.None); // глиф НЕактивной

        // Переключение переносит подчёркивание на другую вкладку.
        panel.setActiveView("b");
        const after = paint(panel, new Size(20, 5));
        expect(at(after, 2, 1).style).toBe(StyleFlags.None);
        expect(at(after, 12, 1).style).toBe(StyleFlags.Underline);
        expect(at(after, 11, 1).style).toBe(StyleFlags.None);
    });

    it("рисует placeholder под названием вкладки и обрезает его по краю панели", () => {
        const panel = themed();
        panel.addView({ id: "a", title: "P", content: null, placeholder: "0123456789ABCDEF" });
        const screen = paint(panel, new Size(10, 5));

        // Начало — первая строка контента, отступ 2; хвост не вылезает за панель.
        expect(row(screen, 2, 0, 10)).toBe("  01234567");
        expect(at(screen, 10, 2).char).not.toBe("8");
        expect(at(screen, 10, 2).bg).not.toBe(BG);
    });

    it("не рисует placeholder, когда строки контента нет вовсе", () => {
        // Панель из двух строк — полоса границы и таб-строка; места под контент
        // не осталось. Проверять это можно только на экране больше панели: на
        // своём запись в несуществующую строку просто съедает клип.
        const panel = themed();
        panel.addView({ id: "a", title: "P", content: null, placeholder: "hidden" });
        const screen = paint(panel, new Size(20, 2));

        expect(row(screen, 1, 0, 4)).toBe("  P ");
        expect(at(screen, 2, 2).char).not.toBe("h");
        expect(at(screen, 2, 2).bg).not.toBe(BG);
    });

    it("вкладка с контентом и без placeholder'а рисуется и раскладывается", () => {
        const panel = themed();
        const content = new MarkerContent("X");
        panel.addView({ id: "a", title: "P", content });
        const screen = paint(panel, new Size(20, 5));

        expect(at(screen, 2, 2).char).toBe("X");
        expect(content.layoutSize).toEqual(new Size(18, 3));
    });

    it("панель без вкладок вовсе раскладывается и рисуется", () => {
        // Нет активной вкладки — ни контролов, ни контента, ни placeholder'а; всё
        // чтение активной вкладки обязано быть опциональным, иначе кадр падает.
        const panel = themed();

        expect(() => paint(panel, new Size(20, 5))).not.toThrow();
        const screen = paint(panel, new Size(20, 5));
        expect(row(screen, 1, 0, 20)).toBe(`${" ".repeat(17)} × `);
    });
});
