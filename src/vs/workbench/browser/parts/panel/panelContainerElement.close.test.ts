import { packRgb } from "@tuidom/core/common/colorUtils";
import { BoxConstraints, Offset, Point, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { ROOT_STYLE_CONTEXT } from "@tuidom/core/dom/styles/tuiStyle";
import type { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { describe, expect, it, vi } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";

import { PanelContainerElement } from "./panelContainerElement.ts";

const BG = packRgb(7, 8, 9);
const CLOSE_FG = packRgb(101, 102, 103);
const HOVER_BG = packRgb(10, 20, 30);

const VARS = {
    "panel.background": BG,
    "panel.border": packRgb(70, 80, 90),
    "panelTitle.inactiveForeground": packRgb(44, 55, 66),
    descriptionForeground: CLOSE_FG,
    "toolbar.hoverBackground": HOVER_BG,
};

/** Панель с двумя вкладками; на ширине 40 кнопка `×` занимает колонки 37..39. */
function panel(): PanelContainerElement {
    const element = new PanelContainerElement();
    element.addView({ id: "problems", title: "PROBLEMS", content: null });
    element.addView({ id: "output", title: "OUTPUT", content: null });
    return element;
}

function render(element: PanelContainerElement, width = 40, height = 8): MockTerminalBackend {
    return renderElement(element, width, height, { styleVars: VARS });
}

function mouse(
    element: PanelContainerElement,
    type: "mousedown" | "mousemove" | "mouseleave",
    init: { x?: number; y?: number; button?: "left" | "right" } = {},
): void {
    const x = init.x ?? 0;
    const y = init.y ?? 1;
    element.dispatchEvent(
        new TUIMouseEvent(type, { button: init.button ?? "left", screenX: x, screenY: y, localX: x, localY: y }),
    );
}

describe("PanelContainerElement: кнопка закрытия панели", () => {
    it("рисует ` × ` в трёх правых колонках строки вкладок", () => {
        const backend = render(panel());

        expect(backend.getTextAt(new Point(37, 1), 3)).toBe(" × ");
        expect(backend.getFgAt(new Point(38, 1))).toBe(CLOSE_FG);
        // В покое фон кнопки — фон панели, подсветка приходит только с курсором.
        expect(backend.getBgAt(new Point(38, 1))).toBe(BG);
        // Строка границы и строки контента кнопкой не задеты.
        expect(backend.getTextAt(new Point(38, 0), 1)).toBe("─");
        expect(backend.getTextAt(new Point(38, 2), 1)).toBe(" ");
    });

    it("клик по кнопке зовёт onClose и не переключает вкладку", () => {
        const element = panel();
        render(element);
        const onClose = vi.fn();
        const onActivate = vi.fn();
        element.onClose = onClose;
        element.onActivateView = onActivate;

        mouse(element, "mousedown", { x: 38 });

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onActivate).not.toHaveBeenCalled();
        // Саму видимость контрол не трогает — это дело команды воркбенча.
        expect(element.getActiveViewId()).toBe("problems");
    });

    it("кнопка срабатывает по любой из своих трёх колонок, но не по соседней", () => {
        const element = panel();
        render(element);
        const onClose = vi.fn();
        element.onClose = onClose;

        for (const x of [37, 38, 39]) mouse(element, "mousedown", { x });
        expect(onClose).toHaveBeenCalledTimes(3);

        // Обе границы зоны: колонка перед кнопкой и первая за правым краем панели.
        mouse(element, "mousedown", { x: 36 });
        mouse(element, "mousedown", { x: 40 });
        expect(onClose).toHaveBeenCalledTimes(3);
    });

    it("рисует кнопку на панели ровно её ширины", () => {
        // Граница «панель уже кнопки»: три колонки — ещё рисуем, две — уже нет.
        const element = panel();
        const backend = render(element, 3, 4);
        const onClose = vi.fn();
        element.onClose = onClose;

        expect(backend.getTextAt(new Point(0, 1), 3)).toBe(" × ");
        mouse(element, "mousedown", { x: 1 });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("на узкой панели кнопка старше таб-строки — иначе из панели было бы не выйти", () => {
        // Ширина 12: сегмент PROBLEMS — [1, 11), кнопка — [9, 12). Колонки 9 и 10
        // принадлежат обоим, и выиграть обязана кнопка.
        const element = panel();
        element.setActiveView("output");
        const backend = render(element, 12);
        const onClose = vi.fn();
        const onActivate = vi.fn();
        element.onClose = onClose;
        element.onActivateView = onActivate;

        expect(backend.getTextAt(new Point(9, 1), 3)).toBe(" × ");

        mouse(element, "mousedown", { x: 10 });
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onActivate).not.toHaveBeenCalled();
        expect(element.getActiveViewId()).toBe("output");
    });

    it("панели уже самой кнопки кнопку не рисует и клики по ней не считает", () => {
        const element = panel();
        const backend = render(element, 2, 4);
        const onClose = vi.fn();
        element.onClose = onClose;

        expect(backend.getTextAt(new Point(0, 1), 2)).not.toContain("×");
        for (const x of [0, 1]) mouse(element, "mousedown", { x });
        expect(onClose).not.toHaveBeenCalled();
    });

    it("не требует колбэка onClose", () => {
        const element = panel();
        render(element);
        expect(() => {
            mouse(element, "mousedown", { x: 38 });
        }).not.toThrow();
    });

    it("правая кнопка мыши панель не закрывает", () => {
        const element = panel();
        render(element);
        const onClose = vi.fn();
        element.onClose = onClose;

        mouse(element, "mousedown", { x: 38, button: "right" });

        expect(onClose).not.toHaveBeenCalled();
    });

    it("клик в той же колонке, но не на строке вкладок, панель не закрывает", () => {
        const element = panel();
        render(element);
        const onClose = vi.fn();
        element.onClose = onClose;

        mouse(element, "mousedown", { x: 38, y: 0 }); // полоса верхней границы
        mouse(element, "mousedown", { x: 38, y: 4 }); // область контента

        expect(onClose).not.toHaveBeenCalled();
    });

    it("подсвечивает фон кнопки под курсором и гасит его, когда курсор ушёл", () => {
        const element = panel();
        render(element);

        mouse(element, "mousemove", { x: 38 });
        expect(render(element).getBgAt(new Point(38, 1))).toBe(HOVER_BG);

        // Курсор съехал по той же строке — подсветка снимается сразу, не дожидаясь mouseleave.
        mouse(element, "mousemove", { x: 20 });
        expect(render(element).getBgAt(new Point(38, 1))).toBe(BG);

        mouse(element, "mousemove", { x: 38 });
        expect(render(element).getBgAt(new Point(38, 1))).toBe(HOVER_BG);
        mouse(element, "mouseleave");
        expect(render(element).getBgAt(new Point(38, 1))).toBe(BG);
    });

    it("не перерисовывает панель, пока курсор ходит внутри кнопки", () => {
        // Мышь шлёт move на каждую колонку; кадр от этого не меняется, и будить
        // перерисовку на каждое движение нельзя.
        const element = panel();
        render(element);
        const markDirty = vi.spyOn(element, "markDirty");

        mouse(element, "mousemove", { x: 37 });
        mouse(element, "mousemove", { x: 38 });
        mouse(element, "mousemove", { x: 39 });
        expect(markDirty).toHaveBeenCalledTimes(1);

        mouse(element, "mousemove", { x: 10 });
        expect(markDirty).toHaveBeenCalledTimes(2);
        markDirty.mockRestore();
    });

    /**
     * Панель в приложении стоит не в начале координат: её смещают сайдбар и
     * область редактора. Экранные координаты события обязаны приводиться к
     * локальным ВЫЧИТАНИЕМ позиции, иначе и кнопка, и вкладки кликаются мимо —
     * а в нуле координат ошибка знака не видна.
     */
    describe("панель смещена от начала координат", () => {
        const ORIGIN = new Offset(7, 4);

        function shifted(width = 40): PanelContainerElement {
            const element = panel();
            element.localPosition = ORIGIN;
            element.layout(BoxConstraints.tight(new Size(width, 8)));
            element.setStyleVars(VARS);
            element.performStyleResolution(ROOT_STYLE_CONTEXT);
            return element;
        }

        /** Клик/движение в ЭКРАННЫХ координатах — как их отдаёт терминал. */
        function screenMouse(element: PanelContainerElement, type: "mousedown" | "mousemove", x: number, y: number) {
            element.dispatchEvent(
                new TUIMouseEvent(type, { button: "left", screenX: x, screenY: y, localX: 0, localY: 0 }),
            );
        }

        it("кнопка закрытия срабатывает по своим экранным координатам", () => {
            const element = shifted();
            const onClose = vi.fn();
            element.onClose = onClose;
            const close = element.inspectState().close as { centerX: number };
            const tabRow = element.inspectState().tabRow as number;
            expect(close.centerX).toBe(ORIGIN.dx + 38);
            expect(tabRow).toBe(ORIGIN.dy + 1);

            screenMouse(element, "mousedown", close.centerX, tabRow);
            expect(onClose).toHaveBeenCalledTimes(1);

            // Та же колонка, но без поправки на смещение — мимо кнопки.
            screenMouse(element, "mousedown", 38, 1);
            expect(onClose).toHaveBeenCalledTimes(1);
        });

        it("клик по вкладке срабатывает по её экранным координатам", () => {
            const element = shifted();
            const onActivate = vi.fn();
            element.onActivateView = onActivate;
            const state = element.inspectState();
            const tabs = state.tabs as { id: string; centerX: number }[];
            const output = tabs[1];

            screenMouse(element, "mousedown", output.centerX, state.tabRow as number);
            expect(onActivate).toHaveBeenCalledWith("output");
            expect(element.getActiveViewId()).toBe("output");
        });

        it("подсветка кнопки считается от смещения, а не от нуля", () => {
            const element = shifted();
            const close = element.inspectState().close as { centerX: number };
            const tabRow = element.inspectState().tabRow as number;
            const markDirty = vi.spyOn(element, "markDirty");

            screenMouse(element, "mousemove", 38, 1); // без поправки — не кнопка
            expect(markDirty).not.toHaveBeenCalled();

            screenMouse(element, "mousemove", close.centerX, tabRow);
            expect(markDirty).toHaveBeenCalledTimes(1);
            markDirty.mockRestore();
        });
    });

    it("курсор на той же колонке вне строки вкладок кнопку не подсвечивает", () => {
        const element = panel();
        render(element);

        mouse(element, "mousemove", { x: 38, y: 3 });

        expect(render(element).getBgAt(new Point(38, 1))).toBe(BG);
    });
});
