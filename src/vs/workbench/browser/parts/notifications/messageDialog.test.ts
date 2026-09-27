import { Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import type { IActiveNotification } from "../../../services/notification/browser/notificationService.ts";

import { MESSAGE_DIALOG_CLOSE_LABEL, MessageDialog } from "./messageDialog.ts";

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
