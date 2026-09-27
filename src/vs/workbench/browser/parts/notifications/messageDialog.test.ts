import { BoxConstraints, Point, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { describe, expect, it, vi } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import type { IActiveNotification } from "../../../services/notification/browser/notificationService.ts";

import { MESSAGE_DIALOG_CLOSE_LABEL, MESSAGE_DIALOG_ELEMENT_ID, MessageDialog } from "./messageDialog.ts";

function notification(patch: Partial<IActiveNotification> = {}): IActiveNotification {
    return { id: 1, severity: "warn", message: "Delete 12 files?", modal: true, items: [], ...patch };
}

function mount(patch: Partial<IActiveNotification> = {}) {
    const dialog = new MessageDialog(notification(patch));
    const testApp = TestApp.createWithContent(dialog.view, new Size(90, 24));
    const buttons = testApp.querySelectorAll("ButtonElement") as ButtonElement[];
    return { dialog, testApp, buttons };
}

function screen(testApp: TestApp): string {
    testApp.render();
    return testApp.backend.screenToString();
}

describe("MessageDialog — что видно на кадре", () => {
    it("окно собрано ровно так: текст, пустая строка, detail, кнопки ПО ЦЕНТРУ", () => {
        // Ассерт на всю рамку: он держит порядок строк, отступ detail'а и
        // центрирование ряда кнопок по фактической ширине окна.
        const dialog = new MessageDialog(
            notification({ message: "Delete 12 files?", detail: "Нельзя отменить.", items: ["Delete", "Cancel"] }),
        );
        const backend = renderElement(dialog.view, 60, 16, {
            constraints: BoxConstraints.loose(new Size(60, 16)),
            themeVars: true,
        });
        const box = backend
            .screenToString()
            .split("\n")
            .map((row) => row.replace(/[\uE000-\uF8FF]/gu, "").replace(/\s+$/, ""))
            .filter((row) => row !== "");

        expect(box).toEqual([
            "╭──────────────────────────╮",
            // Заголовок — строка рамки со значком строгости.
            "│         Warning         │",
            "├──────────────────────────┤",
            "│  Delete 12 files?        │",
            "│                          │",
            "│  Нельзя отменить.        │",
            "│                          │",
            "│  [ Delete ]  [ Cancel ]  │",
            "╰──────────────────────────╯",
        ]);
    });

    it("кнопки центрированы по ширине окна, а не прижаты к краю", () => {
        // Широкое сообщение — тогда отступ центрирования не нулевой, и любая
        // ошибка в его арифметике видна прямо в кадре. Проверяем сам инвариант
        // «по центру»: отступы слева и справа от ряда равны с точностью до ряда.
        const dialog = new MessageDialog(notification({ message: "x".repeat(50), items: ["Ok"] }));
        const backend = renderElement(dialog.view, 60, 12, {
            constraints: BoxConstraints.loose(new Size(60, 12)),
            themeVars: true,
        });
        const row = backend
            .screenToString()
            .split("\n")
            .find((line) => line.includes("[ Ok ]"));
        const inner = (row ?? "").slice((row ?? "").indexOf("│") + 1, (row ?? "").lastIndexOf("│"));
        const left = inner.length - inner.trimStart().length;
        const right = inner.length - inner.trimEnd().length;

        expect(left).toBeGreaterThan(0);
        expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
    });

    it("окно адресуемо селектором #messageDialog", () => {
        const { testApp } = mount();
        expect(testApp.querySelector(`#${MESSAGE_DIALOG_ELEMENT_ID}`)).not.toBeNull();
    });

    it("detail приглушён — он не спорит с текстом сообщения", () => {
        const { testApp } = mount({ detail: "подробности" });
        testApp.render();
        const rows = testApp.backend.screenToString().split("\n");
        const detailRow = rows.findIndex((row) => row.includes("подробности"));
        const messageRow = rows.findIndex((row) => row.includes("Delete 12 files?"));

        expect(testApp.backend.getFgAt(new Point(rows[detailRow].indexOf("подробности"), detailRow))).not.toBe(
            testApp.backend.getFgAt(new Point(rows[messageRow].indexOf("Delete"), messageRow)),
        );
    });

    it("без detail лишней пустой строки в окне не появляется", () => {
        const withoutDetail = new MessageDialog(notification({ message: "short", items: ["Ok"] }));
        const withDetail = new MessageDialog(notification({ message: "short", detail: "d", items: ["Ok"] }));
        const rows = (dialog: MessageDialog): number =>
            dialog.view.getMaxIntrinsicHeight(dialog.view.getMaxIntrinsicWidth(0));

        expect(rows(withDetail) - rows(withoutDetail)).toBe(2);
    });

    it("заголовок по строгости, текст и кнопки", () => {
        const { testApp } = mount({ items: ["Delete", "Cancel"] });
        const text = screen(testApp);
        expect(text).toContain("Warning");
        expect(text).toContain("Delete 12 files?");
        expect(text).toContain("Cancel");
    });

    it("detail показывается отдельной строкой", () => {
        const { testApp } = mount({ detail: "Это действие нельзя отменить." });
        expect(screen(testApp)).toContain("Это действие нельзя отменить.");
    });

    it("длинный текст переносится по словам", () => {
        const { testApp } = mount({ message: "слово ".repeat(40) });
        const rows = screen(testApp).split("\n");
        const contentRows = rows.filter((row) => row.includes("слово"));
        expect(contentRows.length).toBeGreaterThan(1);
    });

    it("без кнопок появляется единственная OK: иначе окно не закрыть", () => {
        const { buttons, testApp } = mount();
        expect(buttons.map((b) => b.getLabel())).toEqual([MESSAGE_DIALOG_CLOSE_LABEL]);
        expect(screen(testApp)).toContain(MESSAGE_DIALOG_CLOSE_LABEL);
    });
});

describe("MessageDialog — ответ", () => {
    it("Enter на кнопке отдаёт её индекс", () => {
        const { dialog, testApp, buttons } = mount({ items: ["Delete", "Cancel"] });
        const onSelect = vi.fn();
        dialog.onSelect = onSelect;

        buttons[1].focus();
        testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));

        expect(onSelect).toHaveBeenCalledWith(1);
    });

    it("focusDefault ведёт фокус на первую кнопку", () => {
        const { dialog, testApp, buttons } = mount({ items: ["Delete", "Cancel"] });
        dialog.focusDefault();
        expect(testApp.focusedElement).toBe(buttons[0]);
    });

    it("Escape отдаёт кнопку isCloseAffordance", () => {
        const { dialog, testApp } = mount({ items: ["Delete", "Cancel"], closeAffordance: 1 });
        const onSelect = vi.fn();
        const onClose = vi.fn();
        dialog.onSelect = onSelect;
        dialog.onClose = onClose;
        dialog.focusDefault();

        testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Escape" }));

        expect(onSelect).toHaveBeenCalledWith(1);
        expect(onClose).not.toHaveBeenCalled();
    });

    it("без isCloseAffordance Escape закрывает без выбора", () => {
        const { dialog, testApp } = mount({ items: ["Delete", "Cancel"] });
        const onSelect = vi.fn();
        const onClose = vi.fn();
        dialog.onSelect = onSelect;
        dialog.onClose = onClose;
        dialog.focusDefault();

        testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Escape" }));

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it("кнопка OK у сообщения без кнопок значит «закрыто без выбора»", () => {
        const { dialog, testApp, buttons } = mount();
        const onClose = vi.fn();
        const onSelect = vi.fn();
        dialog.onClose = onClose;
        dialog.onSelect = onSelect;

        buttons[0].focus();
        testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it("окно без обработчиков не падает ни на Enter, ни на Escape", () => {
        const withItems = mount({ items: ["Delete", "Cancel"], closeAffordance: 1 });
        withItems.dialog.focusDefault();
        expect(() => {
            withItems.buttons[0].dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));
            withItems.testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Escape" }));
        }).not.toThrow();

        const withoutItems = mount();
        withoutItems.dialog.focusDefault();
        expect(() => {
            withoutItems.buttons[0].dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));
            withoutItems.testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Escape" }));
        }).not.toThrow();
    });

    it("←/→ ходят по кнопкам", () => {
        const { dialog, testApp, buttons } = mount({ items: ["Delete", "Cancel"] });
        dialog.focusDefault();

        testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "ArrowRight" }));
        expect(testApp.focusedElement).toBe(buttons[1]);
    });

    it("ряд кнопок строится с ОДНИМ растягивающимся спейсером (два кидают в движке)", () => {
        // Регресс живого прогона: центрирование двумя fill-детьми валило окно на
        // постройке («HFlexElement supports at most one fill child»), и отказ
        // доезжал до расширения. Три кнопки — самый широкий ряд.
        expect(() => mount({ items: ["One", "Two", "Three"] })).not.toThrow();
    });
});
