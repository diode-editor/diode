import { BoxConstraints, Point, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { SizedBoxElement } from "@tuidom/elements/layout/sizedBoxElement";
import { VStackElement } from "@tuidom/elements/layout/vStackElement";
import type { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { describe, expect, it, vi } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import type { IActiveNotification } from "../../../services/notification/browser/notificationService.ts";

import {
    NotificationToast,
    TOAST_CLOSE_LABEL,
    TOAST_ELEMENT_ID,
    TOAST_HINT_FOCUSED,
    TOAST_MAX_LINES,
    TOAST_TEXT_WIDTH,
    toastLines,
    toastUnfocusedHint,
} from "./notificationToast.ts";

function notification(patch: Partial<IActiveNotification> = {}): IActiveNotification {
    return { id: 1, severity: "info", message: "hello", modal: false, items: [], ...patch };
}

/** Полная ширина тоста в приложении: текст плюс рамка и отступы контента. */
const TOAST_WIDTH = TOAST_TEXT_WIDTH + 6;

/**
 * Монтирует тост в обёртку ФИКСИРОВАННОЙ ширины — ровно так его держит
 * `NotificationsComponent`. Без обёртки ряд кнопок (в нём растягивающийся
 * спейсер) растянул бы рамку на весь экран, и кадр в тесте не совпадал бы с
 * тем, что видит человек.
 */
function mount(patch: Partial<IActiveNotification> = {}, keyLabel = "F6") {
    const toast = new NotificationToast(notification(patch), keyLabel);
    const holder = new SizedBoxElement(TOAST_WIDTH);
    holder.setChild(toast.view);
    const testApp = TestApp.createWithContent(holder, new Size(70, 20));
    const buttons = testApp.querySelectorAll("ButtonElement") as ButtonElement[];
    return { toast, testApp, buttons };
}

function screen(testApp: TestApp): string {
    testApp.render();
    return testApp.backend.screenToString();
}

/**
 * Рендерит тост в его НАСТОЯЩЕЙ ширине: overlay-слой даёт loose-constraints, и
 * обёртка фиксированной ширины занимает свои {@link TOAST_WIDTH} колонок. Под
 * tight-constraints тестового приложения ряд кнопок растянул бы рамку на весь
 * экран — кадр не совпал бы с тем, что видит человек.
 */
function renderToast(patch: Partial<IActiveNotification> = {}, keyLabel = "F6"): MockTerminalBackend {
    const toast = new NotificationToast(notification(patch), keyLabel);
    const holder = new SizedBoxElement(TOAST_WIDTH);
    holder.setChild(toast.view);
    return renderElement(holder, TOAST_WIDTH, 16, {
        constraints: BoxConstraints.loose(new Size(TOAST_WIDTH, 16)),
        themeVars: true,
    });
}

/**
 * Непустые строки кадра без хвостовых пробелов — рамка тоста как её видно.
 * Значки codicon (приватная область Unicode) вырезаются: нарисовать их может
 * только шрифт, и в текстовом сравнении они только мешают.
 */
function boxLines(backend: MockTerminalBackend): string[] {
    return backend
        .screenToString()
        .split("\n")
        .map((row) => row.replace(/[\uE000-\uF8FF]/gu, "").replace(/\s+$/, ""))
        .filter((row) => row !== "");
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

    it("ровно предельное число строк сохраняется целиком, без многоточия", () => {
        // Ровно TOAST_MAX_LINES строк по ширине рамки — это ещё НЕ «слишком много».
        const exact = Array.from({ length: TOAST_MAX_LINES }, (_, i) => "x".repeat(40) + String(i)).join(" ");
        const lines = toastLines(exact);
        expect(lines).toHaveLength(TOAST_MAX_LINES);
        expect(lines.at(-1)).not.toBe("…");
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
    it("рамка вопроса собрана ровно так: текст, пустая строка, кнопки справа, подсказка", () => {
        // Ассерт на ВСЮ рамку целиком: он держит и порядок строк, и отступы, и
        // прижатие ряда кнопок вправо с одним пробелом между ними. Последняя в
        // ряду — кнопка закрытия: сообщение обязано быть чем убрать.
        const box = boxLines(renderToast({ severity: "warn", message: "Upload failed", items: ["Retry", "Cancel"] }));
        expect(box).toEqual([
            "╭──────────────────────────────────────────────────╮",
            // Заголовок — строка рамки со значком строгости (codicon из
            // приватной области Unicode, поэтому в тексте он «невидим»).
            "│                     Warning                     │",
            "├──────────────────────────────────────────────────┤",
            "│  Upload failed                                   │",
            "│                                                  │",
            "│                      [ Retry ] [ Cancel ] [ × ]  │",
            "│  F6 — ответить                                   │",
            "╰──────────────────────────────────────────────────╯",
        ]);
    });

    it("заголовок покрашен акцентом строгости, а не цветом текста", () => {
        const { testApp } = mount({ severity: "error" });
        testApp.render();
        const rows = testApp.backend.screenToString().split("\n");
        const titleRow = rows.findIndex((row) => row.includes("Error"));
        const titleCol = rows[titleRow].indexOf("Error");
        const messageRow = rows.findIndex((row) => row.includes("hello"));
        const messageCol = rows[messageRow].indexOf("hello");

        expect(testApp.backend.getFgAt(new Point(titleCol, titleRow))).not.toBe(
            testApp.backend.getFgAt(new Point(messageCol, messageRow)),
        );
    });

    it("подсказка приглушена — она не спорит с текстом сообщения", () => {
        const { testApp } = mount({ items: ["One"] });
        testApp.render();
        const rows = testApp.backend.screenToString().split("\n");
        const hintRow = rows.findIndex((row) => row.includes("F6"));
        const messageRow = rows.findIndex((row) => row.includes("hello"));

        expect(testApp.backend.getFgAt(new Point(rows[hintRow].indexOf("F6"), hintRow))).not.toBe(
            testApp.backend.getFgAt(new Point(rows[messageRow].indexOf("hello"), messageRow)),
        );
    });

    it("тост адресуем селектором #notificationToast", () => {
        const { testApp } = mount();
        expect(testApp.querySelector(`#${TOAST_ELEMENT_ID}`)).not.toBeNull();
    });

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

    it("у пассивного тоста в ряду одна кнопка — закрыть, и фокус встаёт на неё", () => {
        const { toast, testApp, buttons } = mount();
        expect(buttons.map((b) => b.getLabel())).toEqual([TOAST_CLOSE_LABEL]);

        toast.focusDefault();
        expect(testApp.focusedElement).toBe(buttons[0]);
    });

    it("кнопка закрытия пассивного тоста закрывает его", () => {
        const { toast, testApp, buttons } = mount();
        const onClose = vi.fn();
        toast.onClose = onClose;

        buttons[0].focus();
        testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("кнопка закрытия вопроса не считается ответом", () => {
        const { toast, testApp, buttons } = mount({ items: ["Activate"] });
        const onSelect = vi.fn();
        const onClose = vi.fn();
        toast.onSelect = onSelect;
        toast.onClose = onClose;

        // Последняя в ряду — «×», а не кнопка расширения.
        buttons.at(-1)?.focus();
        testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onSelect).not.toHaveBeenCalled();
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
        // Ряд — «A» и кнопка закрытия: Tab обходит его по кругу.
        const { toast, testApp, buttons } = mount({ items: ["A"] });
        expect(buttons).toHaveLength(2);
        toast.focusDefault();

        testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Tab" }));
        expect(testApp.focusedElement).toBe(buttons[1]);

        // С последней кнопки — снова на первую.
        testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Tab" }));
        expect(testApp.focusedElement).toBe(buttons[0]);
    });

    it("Tab идёт вперёд, Shift+Tab назад — видно на трёх кнопках", () => {
        // На двух кнопках обе стороны кольца ведут в одну и ту же — направление
        // различимо только начиная с трёх.
        const forward = mount({ items: ["A", "B"] });
        forward.toast.focusDefault();
        forward.testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Tab" }));
        expect(forward.testApp.focusedElement).toBe(forward.buttons[1]);

        const back = mount({ items: ["A", "B"] });
        back.toast.focusDefault();
        back.testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Tab", shiftKey: true }));
        // Назад с первой кнопки — на последнюю в ряду, то есть на «×».
        expect(back.testApp.focusedElement).toBe(back.buttons.at(-1));
    });

    it("Tab не уводит фокус из тоста к соседям по дереву", () => {
        // Сессия тоста passthrough'ная: не перехвати он Tab — фокус ушёл бы к
        // любому другому фокусируемому элементу приложения.
        const toast = new NotificationToast(notification({ items: ["A", "B"] }), "F6");
        const outsider = new ButtonElement("outside");
        const stack = new VStackElement();
        stack.addChild(toast.view, { width: "stretch", height: 12 });
        stack.addChild(outsider, { width: "stretch", height: 1 });
        const testApp = TestApp.createWithContent(stack, new Size(70, 20));
        const buttons = testApp.querySelectorAll("ButtonElement") as ButtonElement[];
        toast.focusDefault();

        for (let i = 0; i < 4; i++) {
            testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Tab" }));
        }

        expect(buttons).toContain(testApp.focusedElement);
        expect(testApp.focusedElement).not.toBe(outsider);
    });

    it("тост без обработчиков не падает ни на Enter, ни на Escape, ни на Tab", () => {
        // Пассивный тост живёт без onSelect/onClose, а клавиши до него доходят
        // (например когда фокус привели командой и тут же нажали Escape).
        const { toast, testApp, buttons } = mount({ items: ["One"] });
        toast.focusDefault();
        expect(() => {
            buttons[0].dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));
            testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Escape" }));
        }).not.toThrow();

        const passive = mount();
        expect(() => {
            passive.toast.view.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Tab" }));
            // И кнопка закрытия: обработчик ей ставит компонент, а виджет живёт и
            // без него (пассивный тост создают и в тестах, и до проводки).
            passive.buttons[0].dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));
        }).not.toThrow();
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
