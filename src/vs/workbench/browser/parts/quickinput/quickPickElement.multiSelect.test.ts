import { Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { describe, expect, it, vi } from "vitest";

import { expectScreen, screen } from "../../../../../TestUtils/expectScreen.ts";
import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";

import { QuickPickElement } from "./quickPickElement.ts";

function makePicker(width = 24): QuickPickElement {
    const picker = new QuickPickElement();
    picker.preferredWidth = width;
    picker.placeholder = "";
    return picker;
}

function render(picker: QuickPickElement, width = 24) {
    return renderElement(picker, width, picker.getMinIntrinsicHeight(width), { themeVars: true });
}

/** Клавиша прямо на виджет — минуя фокус: нас интересует его собственный разбор. */
function key(picker: QuickPickElement, name: string): void {
    picker.dispatchEvent(new TUIKeyboardEvent("keydown", { key: name }));
}

const ITEMS: QuickPickItem[] = [{ label: "alpha" }, { label: "beta" }, { label: "gamma" }];

describe("QuickPickElement — чекбоксы множественного выбора", () => {
    it("без canPickMany колонки чекбоксов нет вовсе", () => {
        const picker = makePicker();
        picker.items = ITEMS;
        expectScreen(
            render(picker),
            screen`
                ╭──────────────────────╮
                │                      │
                ├──────────────────────┤
                │ alpha                │
                │ beta                 │
                │ gamma                │
                ╰──────────────────────╯
            `,
        );
    });

    it("с canPickMany у каждой строки пустой чекбокс", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = ITEMS;
        expectScreen(
            render(picker),
            screen`
                ╭──────────────────────╮
                │                      │
                ├──────────────────────┤
                │ [ ] alpha            │
                │ [ ] beta             │
                │ [ ] gamma            │
                ╰──────────────────────╯
            `,
        );
    });

    it("отмеченная строка рисуется галочкой", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = ITEMS;
        picker.setCheckedItems([ITEMS[1]]);
        expectScreen(
            render(picker),
            screen`
                ╭──────────────────────╮
                │                      │
                ├──────────────────────┤
                │ [ ] alpha            │
                │ [✓] beta             │
                │ [ ] gamma            │
                ╰──────────────────────╯
            `,
        );
    });

    it("setCheckedItems заменяет набор целиком, а не дополняет его", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = ITEMS;
        picker.setCheckedItems([ITEMS[0]]);
        picker.setCheckedItems([ITEMS[2]]);
        expect([...picker.checkedItems]).toEqual([ITEMS[2]]);
        expectScreen(
            render(picker),
            screen`
                ╭──────────────────────╮
                │                      │
                ├──────────────────────┤
                │ [ ] alpha            │
                │ [ ] beta             │
                │ [✓] gamma            │
                ╰──────────────────────╯
            `,
        );
    });

    it("колонка иконок и колонка чекбоксов вместе ужимают лейбл, а не накладываются", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = [{ icon: "T", label: "очень-длинное-имя-строки" }];
        expectScreen(
            render(picker),
            screen`
                ╭──────────────────────╮
                │                      │
                ├──────────────────────┤
                │ [ ] T очень-длинное… │
                ╰──────────────────────╯
            `,
        );
    });

    it("Space переключает отметку строки под курсором прямо на кадре", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = ITEMS;
        key(picker, " ");
        expectScreen(
            render(picker),
            screen`
                ╭──────────────────────╮
                │                      │
                ├──────────────────────┤
                │ [✓] alpha            │
                │ [ ] beta             │
                │ [ ] gamma            │
                ╰──────────────────────╯
            `,
        );
    });

    it("чекбокс ужимает место под лейбл, а не наезжает на него", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = [{ label: "очень-длинное-имя-строки" }];
        expectScreen(
            render(picker),
            screen`
                ╭──────────────────────╮
                │                      │
                ├──────────────────────┤
                │ [ ] очень-длинное-и… │
                ╰──────────────────────╯
            `,
        );
    });
});

describe("QuickPickElement — Space в множественном выборе", () => {
    it("Space отмечает строку, подсветка и показ остаются на месте", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = ITEMS;
        key(picker, "ArrowDown");
        key(picker, " ");
        expect(picker.selectedIndex).toBe(1);
        expect([...picker.checkedItems]).toEqual([ITEMS[1]]);
    });

    it("повторный Space снимает отметку", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = ITEMS;
        key(picker, " ");
        key(picker, " ");
        expect([...picker.checkedItems]).toEqual([]);
    });

    it("вне множественного выбора Space виджет не трогает — это символ запроса", () => {
        const picker = makePicker();
        picker.items = ITEMS;
        const event = new TUIKeyboardEvent("keydown", { key: " " });
        picker.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
        expect([...picker.checkedItems]).toEqual([]);
    });

    it("в множественном выборе Space съедается и в строку запроса не попадает", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = ITEMS;
        const event = new TUIKeyboardEvent("keydown", { key: " " });
        picker.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    });

    it("Space на пустом списке ничего не ломает", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = [];
        expect(() => {
            key(picker, " ");
        }).not.toThrow();
        expect([...picker.checkedItems]).toEqual([]);
    });
});

describe("QuickPickElement — Enter в множественном выборе", () => {
    it("Enter зовёт onAcceptMany, а не onAccept", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = ITEMS;
        let many = 0;
        let single = 0;
        picker.onAcceptMany = () => many++;
        picker.onAccept = () => single++;
        key(picker, "Enter");
        expect([many, single]).toEqual([1, 0]);
    });

    it("Enter файрится и на пустом списке", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = [];
        let many = 0;
        picker.onAcceptMany = () => many++;
        key(picker, "Enter");
        expect(many).toBe(1);
    });

    it("вне множественного выбора Enter по-прежнему зовёт onAccept", () => {
        const picker = makePicker();
        picker.items = ITEMS;
        let accepted: QuickPickItem | null = null;
        picker.onAccept = (item) => {
            accepted = item;
        };
        picker.onAcceptMany = () => {
            throw new Error("onAcceptMany не должен звучать в одиночном выборе");
        };
        key(picker, "Enter");
        expect(accepted).toBe(ITEMS[0]);
    });
});

describe("QuickPickElement.resetFlavorState", () => {
    it("гасит режим, отметки и колбэк — чекбоксы не протекают в следующий показ", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = ITEMS;
        picker.setCheckedItems([ITEMS[0]]);
        picker.onAcceptMany = () => undefined;

        picker.resetFlavorState();

        expect(picker.canPickMany).toBe(false);
        expect([...picker.checkedItems]).toEqual([]);
        expect(picker.onAcceptMany).toBeNull();
    });

    it("после сброса строки рисуются без колонки чекбоксов", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = ITEMS;
        picker.setCheckedItems([ITEMS[0]]);
        picker.resetFlavorState();
        picker.items = ITEMS;
        expectScreen(
            render(picker),
            screen`
                ╭──────────────────────╮
                │                      │
                ├──────────────────────┤
                │ alpha                │
                │ beta                 │
                │ gamma                │
                ╰──────────────────────╯
            `,
        );
    });

    it("после сброса Enter снова уходит в onAccept", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = ITEMS;
        picker.resetFlavorState();
        let accepted: QuickPickItem | null = null;
        picker.onAccept = (item) => {
            accepted = item;
        };
        key(picker, "Enter");
        expect(accepted).toBe(ITEMS[0]);
    });
});

describe("QuickPickElement — перестройка строк держит экран на месте", () => {
    function longList(): QuickPickItem[] {
        return Array.from({ length: 40 }, (_, i) => ({ label: `item-${String(i + 1).padStart(2, "0")}` }));
    }

    it("отметка в прокрученном списке не отматывает его наверх", () => {
        const picker = makePicker(30);
        picker.canPickMany = true;
        picker.items = longList();
        render(picker, 30);
        for (let i = 0; i < 20; i++) key(picker, "ArrowDown");
        const scrolledIndex = picker.selectedIndex;
        expect(scrolledIndex).toBe(20);

        key(picker, " ");

        // Курсор там же, отмечена именно та строка, и список не прыгнул.
        expect(picker.selectedIndex).toBe(scrolledIndex);
        expect([...picker.checkedItems].map((i) => i.label)).toEqual(["item-21"]);
        expect(picker.inspectState().checked).toEqual(["item-21"]);
    });

    it("отметка не будит живое превью — это не навигация", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = ITEMS;
        const onActive = vi.fn();
        picker.onActiveItemChanged = onActive;
        key(picker, " ");
        expect(onActive).not.toHaveBeenCalled();
    });
});

describe("QuickPickElement.inspectState — отметки", () => {
    it("в множественном выборе отдаёт лейблы отмеченных в порядке списка", () => {
        const picker = makePicker();
        picker.canPickMany = true;
        picker.items = ITEMS;
        picker.setCheckedItems([ITEMS[2], ITEMS[0]]);
        expect(picker.inspectState().checked).toEqual(["alpha", "gamma"]);
    });

    it("в одиночном выборе поля отметок нет вовсе", () => {
        const picker = makePicker();
        picker.items = ITEMS;
        expect(picker.inspectState()).not.toHaveProperty("checked");
    });
});

describe("QuickPickElement — клик в множественном выборе", () => {
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

    /** Экранная строка первого элемента: рамка(1) + запрос(2) + сепаратор(3). */
    const FIRST_ROW_Y = 4;

    function mount(): { picker: QuickPickElement; app: TestApp } {
        const picker = makePicker(30);
        picker.canPickMany = true;
        picker.items = ITEMS;
        const app = TestApp.createWithContent(picker, new Size(30, picker.getMinIntrinsicHeight(30)));
        app.render();
        return { picker, app };
    }

    function click(app: TestApp, y: number): void {
        app.backend.simulateMouse(token({ action: "press", x: 5, y }));
        app.backend.simulateMouse(token({ action: "release", x: 5, y }));
    }

    it("клик по строке переключает её отметку, а не принимает показ", () => {
        const { picker, app } = mount();
        const onAcceptMany = vi.fn();
        picker.onAcceptMany = onAcceptMany;

        click(app, FIRST_ROW_Y + 1);

        expect([...picker.checkedItems]).toEqual([ITEMS[1]]);
        expect(onAcceptMany).not.toHaveBeenCalled();
    });

    it("повторный клик по той же строке снимает отметку", () => {
        const { picker, app } = mount();
        click(app, FIRST_ROW_Y);
        click(app, FIRST_ROW_Y);
        expect([...picker.checkedItems]).toEqual([]);
    });
});
