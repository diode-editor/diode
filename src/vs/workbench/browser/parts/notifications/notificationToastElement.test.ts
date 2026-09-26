import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { computeThemeVars } from "../../../../platform/theme/browser/themeStyleVars.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import type { INotification } from "../../../services/notification/common/notification.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";

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

    // Цвет заголовка — единственное, чем строгость видна на кадре; снимаем его с
    // ячейки, а не с вызова сеттера (иначе тест не заметил бы, что цвет не доехал).
    it("заголовок покрашен токеном своей строгости", () => {
        const fgOfTitle = (severity: INotification["severity"], word: string): number => {
            const toast = makeToast({ severity }, null, 30);
            const app = TestApp.createWithContent(toast, new Size(30, toast.totalHeight));
            app.render();
            const row = app.backend
                .screenToString()
                .split("\n")
                .findIndex((line) => line.includes(word));
            const column = app.backend.screenToString().split("\n")[row].indexOf(word);
            return app.backend.getFgAt(new Point(column, row));
        };
        const info = fgOfTitle("info", "Information");
        const warning = fgOfTitle("warning", "Warning");
        const error = fgOfTitle("error", "Error");
        expect(new Set([info, warning, error]).size).toBe(3);
    });

    it("сообщение без кнопок не заводит ни распорку, ни пустой ряд кнопок", () => {
        const toast = makeToast({ message: "hi" }, null, 24);
        const rows = frameOf(toast).split("\n");
        // Рамка + заголовок + одна строка текста + рамка — ровно четыре ряда.
        expect(rows.filter((row) => row.trim() !== "")).toHaveLength(4);
        // И собрано ровно столько рядов, сколько посчитано: лишний ряд кнопок
        // не влез бы в высоту и молча обрезался, а не показался на кадре.
        expect(toast.inspectState()).toMatchObject({ rows: 1 });
    });

    it("с кнопками собираются текст, распорка и ряд кнопок", () => {
        const toast = makeToast({ message: "hi", items: ["OK"] }, null, 24);
        expect(toast.inspectState()).toMatchObject({ rows: 3 });
    });

    it("ряд кнопок: отступ от рамки один, между кнопками один пробел", () => {
        const toast = makeToast({ message: "hi", items: ["A", "B"] }, null, 30);
        // Вместе с рамкой: `│ [ A ] [ B ]`. Без левого края ассерт не заметил бы
        // лишнего отступа ПЕРЕД первой кнопкой (мутант `index >= 0`).
        expect(frameOf(toast)).toContain("│ [ A ] [ B ]");
    });

    it("над ряд­ом кнопок — пустая строка-распорка, а не текст вплотную", () => {
        const toast = makeToast({ message: "hi", items: ["A"] }, null, 30);
        const rows = frameOf(toast).split("\n");
        const buttonRow = rows.findIndex((row) => row.includes("[ A ]"));
        const textRow = rows.findIndex((row) => row.includes("hi"));
        expect(buttonRow - textRow).toBe(2);
        expect(rows[textRow + 1].replaceAll("│", "").trim()).toBe("");
    });

    // Цвета тела и подсказки — из ячеек кадра: сеттер, который «вызван, но не
    // доехал», ассерт на вызов не заметил бы.
    // Сверяем с РАЗРЕЗОЛВЛЕННЫМ значением токена, а не с соседней областью:
    // в тестовой палитре фон окружения совпадает с фоном тоста, и «покрашен
    // своим» от «унаследовал» сравнением с соседом не отличить.
    it("тело тоста покрашено именно токенами notifications.*", () => {
        const vars = computeThemeVars(WorkbenchTheme.fromThemeFile(darkPlusTheme));
        const toast = makeToast({ message: "hi" }, null, 20);
        const app = TestApp.createWithContent(toast, new Size(20, toast.totalHeight));
        app.render();
        const rows = app.backend.screenToString().split("\n");
        const row = rows.findIndex((line) => line.includes("hi"));
        const column = rows[row].indexOf("hi");
        expect(app.backend.getFgAt(new Point(column, row))).toBe(vars["notifications.foreground"]);
        expect(app.backend.getBgAt(new Point(column, row))).toBe(vars["notifications.background"]);
    });

    it("тело тоста покрашено своими токенами, подсказка — приглушённым", () => {
        const toast = makeToast({ message: "hi", items: ["OK"] }, "hint here", 30);
        const app = TestApp.createWithContent(toast, new Size(30, toast.totalHeight));
        app.render();
        const rows = app.backend.screenToString().split("\n");
        const at = (needle: string): { fg: number; bg: number } => {
            const row = rows.findIndex((line) => line.includes(needle));
            const column = rows[row].indexOf(needle);
            return { fg: app.backend.getFgAt(new Point(column, row)), bg: app.backend.getBgAt(new Point(column, row)) };
        };
        const body = at("hi");
        const hint = at("hint here");
        // Подсказка приглушена — её цвет ОТЛИЧАЕТСЯ от основного текста…
        expect(hint.fg).not.toBe(body.fg);
        // …но фон у них общий: это одно окно, а не два.
        expect(hint.bg).toBe(body.bg);
    });

    it("inspectState отдаёт подписи кнопок — их читает инспектор", () => {
        const toast = makeToast({ items: ["Activate", "Free"] }, null, 30);
        expect(toast.inspectState()).toMatchObject({ buttons: ["Activate", "Free"], severity: "info" });
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
