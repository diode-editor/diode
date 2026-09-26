import { Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import type { INotification } from "../../../services/notification/common/notification.ts";

import { NotificationToastElement } from "./notificationToastElement.ts";

function notification(patch: Partial<INotification> = {}): INotification {
    return { id: 1, severity: "info", message: "hello", items: [], ...patch };
}

function makeToast(patch: Partial<INotification> = {}, hint: string | null = null, width = 24) {
    const toast = new NotificationToastElement();
    toast.preferredWidth = width;
    toast.setNotification(notification(patch), hint);
    return toast;
}

/** Отрисованный кадр тоста текстом (рамка + содержимое). */
function frameOf(toast: NotificationToastElement): string {
    const app = TestApp.createWithContent(toast, new Size(toast.preferredWidth, toast.totalHeight));
    app.render();
    return app.backend.screenToString();
}

describe("NotificationToastElement", () => {
    it("до setNotification тост пуст и ничего не знает о сообщении", () => {
        const toast = new NotificationToastElement();
        expect(toast.notificationId).toBeNull();
        expect(toast.buttons()).toEqual([]);
        expect(toast.inspectState()).toMatchObject({ severity: null, lines: [], buttons: [], hint: null });
    });

    it("заголовок рамки — слово строгости", () => {
        expect(frameOf(makeToast({ severity: "info" }))).toContain("Information");
        expect(frameOf(makeToast({ severity: "warning" }))).toContain("Warning");
        expect(frameOf(makeToast({ severity: "error" }))).toContain("Error");
    });

    it("текст переносится по внутренней ширине", () => {
        const toast = makeToast({ message: "Thank you for installing Supermaven" }, null, 24);
        expect(toast.inspectState()).toMatchObject({ lines: ["Thank you for", "installing", "Supermaven"] });
    });

    it("пункты сообщения становятся кнопками в том же порядке", () => {
        const toast = makeToast({ items: ["Activate", "Use free version"] });
        expect(toast.buttons().map((b) => b.getLabel())).toEqual(["Activate", "Use free version"]);
        expect(frameOf(toast)).toContain("Activate");
    });

    it("кнопка зовёт onActivate со своим индексом", () => {
        const toast = makeToast({ items: ["A", "B"] });
        const activated = vi.fn();
        toast.onActivate = activated;
        toast.buttons()[1].onActivate?.();
        expect(activated).toHaveBeenCalledWith(1);
    });

    it("кнопка без подписанного onActivate не падает", () => {
        const toast = makeToast({ items: ["A"] });
        expect(() => toast.buttons()[0].onActivate?.()).not.toThrow();
    });

    it("подсказка рисуется строкой под кнопками", () => {
        const toast = makeToast({ items: ["OK"] }, "Ctrl+K Ctrl+N to answer", 32);
        expect(toast.inspectState()).toMatchObject({ hint: "Ctrl+K Ctrl+N to answer" });
        expect(frameOf(toast)).toContain("Ctrl+K Ctrl+N to answer");
    });

    it("высота: рамка + заголовок + строки; кнопки добавляют пустую строку и ряд", () => {
        // 2 рамки + 1 заголовок + 1 строка текста.
        expect(makeToast({ message: "hi" }).totalHeight).toBe(4);
        // …плюс распорка и ряд кнопок.
        expect(makeToast({ message: "hi", items: ["OK"] }).totalHeight).toBe(6);
        // …плюс строка подсказки.
        expect(makeToast({ message: "hi", items: ["OK"] }, "hint").totalHeight).toBe(7);
    });

    it("повторный setNotification заменяет содержимое (кнопки прежнего не остаются)", () => {
        const toast = makeToast({ items: ["Old"] });
        toast.setNotification(notification({ id: 2, message: "second", items: [] }), null);
        expect(toast.notificationId).toBe(2);
        expect(toast.buttons()).toEqual([]);
        expect(frameOf(toast)).not.toContain("Old");
    });

    it("узкие constraints не выпускают тост за пределы отведённого места", () => {
        const toast = makeToast({ message: "длинное сообщение про ссылку" }, null, 40);
        const app = TestApp.createWithContent(toast, new Size(20, 5));
        app.render();
        expect(
            app.backend
                .screenToString()
                .split("\n")
                .every((line) => line.length <= 20),
        ).toBe(true);
    });
});
