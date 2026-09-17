import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { expectScreen, screen } from "../../../../../TestUtils/expectScreen.ts";
import { renderElement } from "../../../../../TestUtils/renderElement.ts";

import { TabSwitcherElement, type TabSwitcherItem } from "./tabSwitcherElement.ts";

const ICON_COLOR = packRgb(49, 120, 198);

function item(label: string, overrides: Partial<TabSwitcherItem> = {}): TabSwitcherItem {
    // ASCII-«иконка» вместо глифа nerd font — чтобы ожидаемый кадр читался.
    return { icon: "T", iconColor: ICON_COLOR, label, isModified: false, ...overrides };
}

function makeSwitcher(width = 24): TabSwitcherElement {
    const switcher = new TabSwitcherElement();
    switcher.preferredWidth = width;
    return switcher;
}

function render(switcher: TabSwitcherElement, width = 24) {
    return renderElement(switcher, width, switcher.totalHeight, { themeVars: true });
}

describe("TabSwitcherElement — раскладка", () => {
    it("рамка, по строке на вкладку: иконка, метка, маркер изменённости справа", () => {
        const switcher = makeSwitcher(24);
        switcher.setItems([item("a.ts"), item("b.ts", { isModified: true })], 1);

        expectScreen(
            render(switcher, 24),
            screen`
                ╭──────────────────────╮
                │ T a.ts               │
                │ T b.ts             ● │
                ╰──────────────────────╯
            `,
        );
    });

    it("позиция цикла подсвечена цветом выделения списка на всю строку", () => {
        const switcher = makeSwitcher(24);
        switcher.setItems([item("a.ts"), item("b.ts")], 1);

        const backend = render(switcher, 24);
        // Строка 2 (b.ts) выделена, строка 1 — фон пикера: сравниваем между собой,
        // чтобы не зашивать конкретные RGB темы.
        const plainBg = backend.getBgAt(new Point(5, 1));
        const currentBg = backend.getBgAt(new Point(5, 2));
        expect(currentBg).not.toBe(plainBg);
        // Невыделенная строка красится фоном пикера (как рамка), выделенная — нет:
        // фиксируем, КАКАЯ из строк подсвечена, а не только «строки различаются».
        const frameBg = backend.getBgAt(new Point(5, 0));
        expect(plainBg).toBe(frameBg);
        // Выделение тянется на всю внутреннюю ширину, включая колонку маркера.
        expect(backend.getBgAt(new Point(21, 2))).toBe(currentBg);
    });

    it("длинная метка усечена по бюджету строки", () => {
        const switcher = makeSwitcher(16);
        switcher.setItems([item("veryLongFileName.ts")], 0);

        const backend = render(switcher, 16);
        const line = backend.screenToString().split("\n")[1];
        expect(line).toContain("…");
        expect(line).not.toContain("veryLongFileName.ts");
    });

    it("маркер изменённости не съедается длинной меткой: бюджет метки учитывает его колонку", () => {
        const switcher = makeSwitcher(16);
        switcher.setItems([item("veryLongFileName.ts", { isModified: true })], 0);

        // 16 колонок: рамка 2 + отступы 2 + иконка 2 + маркер 2 → метке 8.
        expectScreen(
            render(switcher, 16),
            screen`
                ╭──────────────╮
                │ T veryLon… ● │
                ╰──────────────╯
            `,
        );
    });

    it("окно в maxVisibleItems строк едет за позицией цикла и возвращается к началу", () => {
        const switcher = makeSwitcher(24);
        switcher.maxVisibleItems = 3;
        const items = Array.from({ length: 5 }, (_, i) => item(`f${String(i)}.ts`));

        switcher.setItems(items, 1);
        expect(switcher.inspectState()).toMatchObject({ currentIndex: 1, windowStart: 0 });

        // Позиция ушла за нижний край окна [0..2] — окно тянется вниз.
        switcher.setItems(items, 3);
        expect(switcher.inspectState()).toMatchObject({ currentIndex: 3, windowStart: 1 });

        expectScreen(
            render(switcher, 24),
            screen`
                ╭──────────────────────╮
                │ T f1.ts              │
                │ T f2.ts              │
                │ T f3.ts              │
                ╰──────────────────────╯
            `,
        );

        // Шаг назад ВНУТРИ окна [1..3] окно не двигает.
        switcher.setItems(items, 2);
        expect(switcher.inspectState()).toMatchObject({ currentIndex: 2, windowStart: 1 });

        // Заворот цикла на начало списка — окно возвращается к первой строке.
        switcher.setItems(items, 0);
        expect(switcher.inspectState()).toMatchObject({ currentIndex: 0, windowStart: 0 });
    });

    it("окно не уезжает за последнюю страницу и позиция клампится в границы", () => {
        const switcher = makeSwitcher(24);
        switcher.maxVisibleItems = 3;
        const items = Array.from({ length: 4 }, (_, i) => item(`f${String(i)}.ts`));

        switcher.setItems(items, 99);
        expect(switcher.inspectState()).toMatchObject({ currentIndex: 3, windowStart: 1 });
    });

    it("список укоротился — окно возвращается в границы новой последней страницы", () => {
        const switcher = makeSwitcher(24);
        switcher.maxVisibleItems = 3;
        const five = Array.from({ length: 5 }, (_, i) => item(`f${String(i)}.ts`));
        switcher.setItems(five, 4);
        expect(switcher.inspectState()).toMatchObject({ windowStart: 2 });

        // Новая серия с тремя вкладками: прежний windowStart=2 вне границ (3
        // строк хватает целиком) — кламп по последней странице возвращает 0.
        switcher.setItems(five.slice(0, 3), 2);
        expect(switcher.inspectState()).toMatchObject({ currentIndex: 2, windowStart: 0 });
    });

    it("свежий элемент пуст: до первой серии строк нет, высота — одна рамка", () => {
        const switcher = makeSwitcher(24);
        expect(switcher.inspectState()).toEqual({ items: [], currentIndex: 0, windowStart: 0 });
        expect(switcher.totalHeight).toBe(2);
    });

    it("иконка держит свой цвет файла, а не наследует цвет строки", () => {
        const switcher = makeSwitcher(24);
        switcher.setItems([item("a.ts")], 0);

        const backend = render(switcher, 24);
        // Колонка иконки — сразу за рамкой и отступом; метка рядом наследует fg пикера.
        expect(backend.getFgAt(new Point(2, 1))).toBe(ICON_COLOR);
        expect(backend.getFgAt(new Point(4, 1))).not.toBe(ICON_COLOR);
    });

    it("inspectState отдаёт метки строк — наблюдаемое состояние для e2e", () => {
        const switcher = makeSwitcher(24);
        switcher.setItems([item("a.ts"), item("b.ts")], 0);
        expect(switcher.inspectState()).toEqual({
            items: ["a.ts", "b.ts"],
            currentIndex: 0,
            windowStart: 0,
        });
    });
});
