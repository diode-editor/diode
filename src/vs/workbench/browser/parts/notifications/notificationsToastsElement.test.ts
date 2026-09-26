import { Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import type { INotification } from "../../../services/notification/common/notification.ts";

import { NotificationsToastsElement } from "./notificationsToastsElement.ts";

function notification(id: number, items: readonly string[] = [], message = `msg-${String(id)}`): INotification {
    return { id, severity: "info", message, items };
}

function mount(notifications: readonly INotification[], hint: string | null = null) {
    const stack = new NotificationsToastsElement();
    stack.preferredWidth = 40;
    stack.setNotifications(notifications, hint);
    const testApp = TestApp.createWithContent(stack, new Size(60, 24));
    return { stack, testApp };
}

/** Клавиша уходит сфокусированному элементу и всплывает до стека, как в приложении. */
function sendToFocused(testApp: TestApp, key: string, shiftKey = false): void {
    testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key, shiftKey }));
}

/** Подпись сфокусированной кнопки; null — фокус не на кнопке. */
function focusedLabel(testApp: TestApp): string | null {
    const focused = testApp.focusedElement as ButtonElement | null;
    return typeof focused?.getLabel === "function" ? focused.getLabel() : null;
}

describe("NotificationsToastsElement", () => {
    it("пустой стек — нулевая высота и никаких тостов", () => {
        const { stack } = mount([]);
        expect(stack.totalHeight).toBe(0);
        expect(stack.inspectState()).toEqual({ ids: [] });
    });

    it("порядок сохраняется: старое сверху, свежее у угла", () => {
        const { stack } = mount([notification(1), notification(2), notification(3)]);
        expect(stack.inspectState()).toEqual({ ids: [1, 2, 3] });
    });

    it("высота стека — сумма высот тостов", () => {
        const { stack } = mount([notification(1), notification(2)]);
        // По 4 строки на тост: рамка + заголовок + строка текста + рамка.
        expect(stack.totalHeight).toBe(8);
    });

    it("подсказку получает только сообщение с кнопками", () => {
        const { testApp } = mount([notification(1), notification(2, ["OK"])], "Ctrl+K Ctrl+N to answer");
        testApp.render();
        // Одна строка подсказки на весь стек — у второго сообщения.
        expect(testApp.backend.screenToString().split("Ctrl+K Ctrl+N to answer")).toHaveLength(2);
    });

    it("focusToasts ведёт на первую кнопку САМОГО СВЕЖЕГО сообщения с кнопками", () => {
        const { stack, testApp } = mount([notification(1, ["Old"]), notification(2, ["Activate", "Free"])]);
        stack.focusToasts();
        expect(focusedLabel(testApp)).toBe("Activate");
    });

    it("без кнопок фокус берёт сам стек — иначе Escape было бы некому доставить", () => {
        const { stack, testApp } = mount([notification(1)]);
        stack.focusToasts();
        expect(testApp.focusedElement).toBe(stack);
    });

    it("Right/Down шагают вперёд по плоскому списку кнопок всех тостов", () => {
        const { stack, testApp } = mount([notification(1, ["A"]), notification(2, ["B", "C"])]);
        stack.focusToasts();
        expect(focusedLabel(testApp)).toBe("B");
        sendToFocused(testApp, "ArrowRight");
        expect(focusedLabel(testApp)).toBe("C");
        // Дальше идти некуда — фокус остаётся на месте.
        sendToFocused(testApp, "ArrowDown");
        expect(focusedLabel(testApp)).toBe("C");
    });

    it("Left/Up/Tab шагают и между тостами", () => {
        const { stack, testApp } = mount([notification(1, ["A"]), notification(2, ["B"])]);
        stack.focusToasts();
        expect(focusedLabel(testApp)).toBe("B");
        sendToFocused(testApp, "ArrowUp");
        expect(focusedLabel(testApp)).toBe("A");
        sendToFocused(testApp, "Tab", true);
        // Раньше первой кнопки идти некуда.
        expect(focusedLabel(testApp)).toBe("A");
        sendToFocused(testApp, "Tab");
        expect(focusedLabel(testApp)).toBe("B");
    });

    it("шаг из «фокус на самом стеке» приводит на крайнюю кнопку, а не мимо списка", () => {
        const { stack, testApp } = mount([notification(1, ["A", "B"])]);
        stack.focus();
        sendToFocused(testApp, "ArrowRight");
        expect(focusedLabel(testApp)).toBe("A");
        stack.focus();
        sendToFocused(testApp, "ArrowLeft");
        expect(focusedLabel(testApp)).toBe("B");
    });

    it("стрелки без единой кнопки в стеке — no-op", () => {
        const { stack, testApp } = mount([notification(1)]);
        stack.focus();
        sendToFocused(testApp, "ArrowRight");
        expect(testApp.focusedElement).toBe(stack);
    });

    it("посторонняя клавиша не трогает фокус", () => {
        const { stack, testApp } = mount([notification(1, ["A", "B"])]);
        stack.focusToasts();
        sendToFocused(testApp, "a");
        expect(focusedLabel(testApp)).toBe("A");
    });

    it("Escape зовёт onHideAll", () => {
        const { stack, testApp } = mount([notification(1, ["A"])]);
        const hideAll = vi.fn();
        stack.onHideAll = hideAll;
        stack.focusToasts();
        sendToFocused(testApp, "Escape");
        expect(hideAll).toHaveBeenCalledTimes(1);
    });

    it("Escape без подписчика не падает", () => {
        const { stack, testApp } = mount([notification(1)]);
        stack.focusToasts();
        expect(() => {
            sendToFocused(testApp, "Escape");
        }).not.toThrow();
    });

    it("Enter по кнопке зовёт onActivate с id её сообщения и индексом", () => {
        const { stack, testApp } = mount([notification(7, ["A", "B"])]);
        const activated = vi.fn();
        stack.onActivate = activated;
        stack.focusToasts();
        sendToFocused(testApp, "ArrowRight");
        sendToFocused(testApp, "Enter");
        expect(activated).toHaveBeenCalledWith(7, 1);
    });

    it("нажатие без подписчика onActivate не падает", () => {
        const { stack, testApp } = mount([notification(1, ["A"])]);
        stack.focusToasts();
        expect(() => {
            sendToFocused(testApp, "Enter");
        }).not.toThrow();
    });

    it("повторный setNotifications выбрасывает прежние тосты", () => {
        const { stack, testApp } = mount([notification(1, [], "первое")]);
        stack.setNotifications([notification(2, [], "второе")], null);
        testApp.render();
        expect(stack.inspectState()).toEqual({ ids: [2] });
        expect(testApp.backend.screenToString()).not.toContain("первое");
    });

    it("узкие constraints клампят ширину стека", () => {
        const stack = new NotificationsToastsElement();
        stack.preferredWidth = 40;
        stack.setNotifications([notification(1)], null);
        const testApp = TestApp.createWithContent(stack, new Size(20, 6));
        testApp.render();
        expect(stack.layoutSize.width).toBe(20);
    });
});
