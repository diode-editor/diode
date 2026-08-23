import { Size } from "@tuidom/core/common/geometryPromitives";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";

import { QuickPickElement } from "./quickPickElement.ts";

/** Мышиный токен движка (координаты 1-based, как в терминале). */
function token(overrides: Partial<MouseToken>): MouseToken {
    return {
        kind: "mouse",
        action: "press",
        button: "left",
        x: 1,
        y: 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
        ...overrides,
    };
}

function makeItems(count: number): QuickPickItem[] {
    return Array.from({ length: count }, (_, i) => ({ label: `file-${String(i + 1)}.ts` }));
}

/**
 * Мышь гоняем через настоящее дерево, а не dispatchEvent'ом: пикер ловит
 * события всплытием из строк списка, и подмена этого пути мимо приложения
 * проверяла бы не то, что происходит у пользователя.
 */
function mount(items: QuickPickItem[]): { picker: QuickPickElement; app: TestApp } {
    const picker = new QuickPickElement();
    picker.preferredWidth = 30;
    picker.placeholder = "";
    picker.items = items;
    const app = TestApp.createWithContent(picker, new Size(30, picker.getMinIntrinsicHeight(30)));
    app.render();
    return { picker, app };
}

/** Экранная строка первого элемента списка: рамка + запрос + сепаратор. */
const FIRST_ROW_Y = 4; // 1-based: рамка(1) + запрос(2) + сепаратор(3) + первый(4)

describe("QuickPickElement — мышь", () => {
    it("наведение ведёт выделение за собой", () => {
        const { picker, app } = mount(makeItems(3));
        expect(picker.selectedIndex).toBe(0);

        app.backend.simulateMouse(token({ action: "move", x: 5, y: FIRST_ROW_Y + 2 }));
        expect(picker.selectedIndex).toBe(2);
    });

    it("наведение не будит живое превью — это не навигация", () => {
        const { picker, app } = mount(makeItems(3));
        const onActive = vi.fn();
        picker.onActiveItemChanged = onActive;

        app.backend.simulateMouse(token({ action: "move", x: 5, y: FIRST_ROW_Y + 1 }));
        expect(picker.selectedIndex).toBe(1);
        expect(onActive).not.toHaveBeenCalled();
    });

    it("клик по строке выделяет её и принимает", () => {
        const { picker, app } = mount(makeItems(3));
        const onAccept = vi.fn();
        picker.onAccept = onAccept;

        app.backend.simulateMouse(token({ action: "press", x: 5, y: FIRST_ROW_Y + 1 }));
        app.backend.simulateMouse(token({ action: "release", x: 5, y: FIRST_ROW_Y + 1 }));

        expect(onAccept).toHaveBeenCalledWith(expect.objectContaining({ label: "file-2.ts" }), 1);
    });

    it("клик по строке запроса и рамке ничего не принимает", () => {
        const { picker, app } = mount(makeItems(3));
        const onAccept = vi.fn();
        picker.onAccept = onAccept;

        app.backend.simulateMouse(token({ action: "press", x: 5, y: 2 }));
        app.backend.simulateMouse(token({ action: "release", x: 5, y: 2 }));

        expect(onAccept).not.toHaveBeenCalled();
    });

    it("правая кнопка строку не принимает — это событие контекстного меню", () => {
        const { picker, app } = mount(makeItems(3));
        const onAccept = vi.fn();
        picker.onAccept = onAccept;

        app.backend.simulateMouse(token({ action: "press", button: "right", x: 5, y: FIRST_ROW_Y }));
        app.backend.simulateMouse(token({ action: "release", button: "right", x: 5, y: FIRST_ROW_Y }));

        expect(onAccept).not.toHaveBeenCalled();
    });

    it("мышь мимо списка выделение не двигает", () => {
        const { picker, app } = mount(makeItems(3));
        app.backend.simulateMouse(token({ action: "move", x: 5, y: FIRST_ROW_Y + 1 }));
        expect(picker.selectedIndex).toBe(1);

        // Строка запроса — выше списка.
        app.backend.simulateMouse(token({ action: "move", x: 5, y: 2 }));
        expect(picker.selectedIndex).toBe(1);
    });

    it("на пустом списке мышь ничего не трогает", () => {
        const { picker, app } = mount([]);
        const onAccept = vi.fn();
        picker.onAccept = onAccept;

        app.backend.simulateMouse(token({ action: "move", x: 5, y: 2 }));
        app.backend.simulateMouse(token({ action: "press", x: 5, y: 2 }));
        app.backend.simulateMouse(token({ action: "release", x: 5, y: 2 }));

        expect(picker.selectedIndex).toBe(0);
        expect(onAccept).not.toHaveBeenCalled();
    });

    it("клик по хвосту списка ниже последней строки ничего не принимает", () => {
        const { picker, app } = mount(makeItems(2));
        const onAccept = vi.fn();
        picker.onAccept = onAccept;
        // Список ужат по числу строк, но проверяем клик за последней из них.
        app.backend.simulateMouse(token({ action: "press", x: 5, y: FIRST_ROW_Y + 5 }));
        app.backend.simulateMouse(token({ action: "release", x: 5, y: FIRST_ROW_Y + 5 }));

        expect(onAccept).not.toHaveBeenCalled();
    });

    it("клик по строке блокируется жёсткой ошибкой валидации", () => {
        const { picker, app } = mount(makeItems(3));
        const onAccept = vi.fn();
        picker.onAccept = onAccept;
        picker.validationMessage = "Name is taken";
        app.render();

        // Строка сообщения сдвинула список на строку вниз.
        app.backend.simulateMouse(token({ action: "press", x: 5, y: FIRST_ROW_Y + 1 }));
        app.backend.simulateMouse(token({ action: "release", x: 5, y: FIRST_ROW_Y + 1 }));

        expect(onAccept).not.toHaveBeenCalled();
    });
});
