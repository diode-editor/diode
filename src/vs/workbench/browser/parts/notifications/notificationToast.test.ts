import { Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import type { IActiveNotification } from "../../../services/notification/browser/notificationService.ts";

import {
    NotificationToast,
    TOAST_HINT_FOCUSED,
    TOAST_MAX_LINES,
    toastLines,
    toastUnfocusedHint,
} from "./notificationToast.ts";

function notification(patch: Partial<IActiveNotification> = {}): IActiveNotification {
    return { id: 1, severity: "info", message: "hello", modal: false, items: [], ...patch };
}

function mount(patch: Partial<IActiveNotification> = {}, keyLabel = "F6") {
    const toast = new NotificationToast(notification(patch), keyLabel);
    const testApp = TestApp.createWithContent(toast.view, new Size(60, 20));
    const buttons = testApp.querySelectorAll("ButtonElement") as ButtonElement[];
    return { toast, testApp, buttons };
}

function screen(testApp: TestApp): string {
    testApp.render();
    return testApp.backend.screenToString();
}

describe("toastLines", () => {
    it("переносит длинный текст по словам", () => {
        const lines = toastLines("Thank you for installing Supermaven! Click 'Activate' to set up a subscription");
        expect(lines.length).toBeGreaterThan(1);
        for (const line of lines) expect(line.length).toBeLessThanOrEqual(46);
    });

    it("короткий текст остаётся одной строкой", () => {
        expect(toastLines("short")).toEqual(["short"]);
    });

    it("слишком длинный текст обрезается многоточием: тост не растёт во весь экран", () => {
        const lines = toastLines("слово ".repeat(200));
        expect(lines).toHaveLength(TOAST_MAX_LINES);
        expect(lines.at(-1)).toBe("…");
    });
});

describe("toastUnfocusedHint", () => {
    it("называет действующую комбинацию", () => {
        expect(toastUnfocusedHint("F6")).toBe("F6 — ответить");
        expect(toastUnfocusedHint("Alt+M")).toBe("Alt+M — ответить");
    });

    it("без бинда называет команду — её найдут в палитре", () => {
        expect(toastUnfocusedHint(undefined)).toContain("Notifications: Focus Message");
    });
});

describe("NotificationToast — что видно на кадре", () => {
    it("строгость видна заголовком", () => {
        expect(screen(mount({ severity: "info" }).testApp)).toContain("Information");
        expect(screen(mount({ severity: "warn" }).testApp)).toContain("Warning");
        expect(screen(mount({ severity: "error" }).testApp)).toContain("Error");
    });

    it("текст сообщения и подписи кнопок нарисованы", () => {
        const { testApp } = mount({ message: "Ruff: formatted", items: ["Activate", "Free"] });
        const text = screen(testApp);
        expect(text).toContain("Ruff: formatted");
        expect(text).toContain("Activate");
        expect(text).toContain("Free");
    });

    it("у тоста без кнопок подсказки нет — отвечать нечего", () => {
        const { toast, testApp } = mount();
        expect(toast.hintText()).toBeNull();
        expect(screen(testApp)).not.toContain("ответить");
    });

    it("у тоста с кнопками подсказка говорит, чем до них добраться", () => {
        const { toast, testApp } = mount({ items: ["One"] });
        expect(toast.hintText()).toBe("F6 — ответить");
        expect(screen(testApp)).toContain("F6 — ответить");
    });
});

describe("NotificationToast — ответ с клавиатуры", () => {
    it("isInteractive различает вопрос и пассивный тост", () => {
        expect(mount({ items: ["One"] }).toast.isInteractive).toBe(true);
        expect(mount().toast.isInteractive).toBe(false);
    });

    it("focusDefault ведёт фокус на первую кнопку и меняет подсказку", () => {
        const { toast, testApp, buttons } = mount({ items: ["Activate", "Free"] });
        toast.focusDefault();

        expect(testApp.focusedElement).toBe(buttons[0]);
        expect(toast.hintText()).toBe(TOAST_HINT_FOCUSED);
    });

    it("focusDefault у тоста без кнопок никого не фокусирует", () => {
        const { toast, testApp } = mount();
        toast.focusDefault();
        expect(testApp.focusedElement).toBeNull();
    });

    it("Enter на кнопке отдаёт её индекс", () => {
        const { toast, testApp, buttons } = mount({ items: ["Activate", "Free"] });
        const onSelect = vi.fn();
        toast.onSelect = onSelect;
        toast.focusDefault();

        buttons[1].focus();
        testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));

        expect(onSelect).toHaveBeenCalledWith(1);
    });

    it("←/→ ходят по ряду кнопок", () => {
        const { toast, testApp, buttons } = mount({ items: ["A", "B"] });
        toast.focusDefault();

        testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "ArrowRight" }));
        expect(testApp.focusedElement).toBe(buttons[1]);

        testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "ArrowLeft" }));
        expect(testApp.focusedElement).toBe(buttons[0]);
    });

    it("Tab ходит по кольцу, а не уводит фокус из тоста", () => {
        const { toast, testApp, buttons } = mount({ items: ["A", "B"] });
        toast.focusDefault();

        testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Tab" }));
        expect(testApp.focusedElement).toBe(buttons[1]);

        // С последней кнопки — снова на первую.
        testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Tab" }));
        expect(testApp.focusedElement).toBe(buttons[0]);
    });

    it("Shift+Tab ходит в обратную сторону", () => {
        const { toast, testApp, buttons } = mount({ items: ["A", "B"] });
        toast.focusDefault();

        testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Tab", shiftKey: true }));
        expect(testApp.focusedElement).toBe(buttons[1]);
    });

    it("Escape закрывает без выбора", () => {
        const { toast, testApp } = mount({ items: ["One"] });
        const onClose = vi.fn();
        const onSelect = vi.fn();
        toast.onClose = onClose;
        toast.onSelect = onSelect;
        toast.focusDefault();

        testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Escape" }));

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it("подсказка возвращается к «как ответить», когда фокус ушёл из тоста", () => {
        const { toast, testApp, buttons } = mount({ items: ["One"] });
        toast.focusDefault();
        expect(toast.hintText()).toBe(TOAST_HINT_FOCUSED);

        buttons[0].blur();
        void testApp;
        expect(toast.hintText()).toBe("F6 — ответить");
    });
});
