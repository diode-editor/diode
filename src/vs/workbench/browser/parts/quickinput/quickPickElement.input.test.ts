import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { describe, expect, it, vi } from "vitest";

import type { QuickPickItem } from "../../../common/quickPickItem.ts";

import { QuickPickElement } from "./quickPickElement.ts";

function makePicker(items: QuickPickItem[] = []): QuickPickElement {
    const picker = new QuickPickElement();
    picker.preferredWidth = 30;
    picker.items = items;
    // Курсор и окно списка живут по фактической раскладке — без неё навигация
    // не имеет геометрии, к которой прокручивать.
    picker.layout(BoxConstraints.tight(new Size(30, picker.getMinIntrinsicHeight(30))));
    return picker;
}

function press(picker: QuickPickElement, key: string): void {
    picker.dispatchEvent(new TUIKeyboardEvent("keydown", { key }));
}

function makeItems(count: number): QuickPickItem[] {
    return Array.from({ length: count }, (_, i) => ({ label: `file-${String(i + 1)}.ts` }));
}

describe("QuickPickElement — клавиатура", () => {
    it("стрелки двигают выделение без заворота", () => {
        const picker = makePicker(makeItems(3));
        expect(picker.selectedIndex).toBe(0);

        press(picker, "ArrowUp");
        expect(picker.selectedIndex).toBe(0);

        press(picker, "ArrowDown");
        press(picker, "ArrowDown");
        expect(picker.selectedIndex).toBe(2);

        press(picker, "ArrowDown");
        expect(picker.selectedIndex).toBe(2);
    });

    it("PageDown/PageUp ходят на окно списка", () => {
        const picker = makePicker(makeItems(30));
        press(picker, "PageDown");
        expect(picker.selectedIndex).toBe(picker.maxVisibleItems);

        press(picker, "PageUp");
        expect(picker.selectedIndex).toBe(0);
    });

    it("Enter в режиме item отдаёт выделенный предмет", () => {
        const picker = makePicker(makeItems(3));
        const onAccept = vi.fn();
        picker.onAccept = onAccept;

        press(picker, "ArrowDown");
        press(picker, "Enter");

        expect(onAccept).toHaveBeenCalledWith(expect.objectContaining({ label: "file-2.ts" }), 1);
    });

    it("Enter на пустом списке в режиме item молчит", () => {
        const picker = makePicker([]);
        const onAccept = vi.fn();
        picker.onAccept = onAccept;

        press(picker, "Enter");
        expect(onAccept).not.toHaveBeenCalled();
    });

    it("Enter в режиме value отдаёт текст запроса", () => {
        const picker = makePicker([]);
        picker.acceptMode = "value";
        const onAcceptValue = vi.fn();
        picker.onAcceptValue = onAcceptValue;
        picker.setQuery("note.txt");

        press(picker, "Enter");
        expect(onAcceptValue).toHaveBeenCalledWith("note.txt");
    });

    it("жёсткая ошибка валидации блокирует Enter в обоих режимах", () => {
        const picker = makePicker(makeItems(2));
        const onAccept = vi.fn();
        const onAcceptValue = vi.fn();
        picker.onAccept = onAccept;
        picker.onAcceptValue = onAcceptValue;
        picker.validationMessage = "Name is taken";
        picker.validationSeverity = "error";

        press(picker, "Enter");
        expect(onAccept).not.toHaveBeenCalled();

        picker.acceptMode = "value";
        press(picker, "Enter");
        expect(onAcceptValue).not.toHaveBeenCalled();
    });

    it("предупреждение Enter не блокирует", () => {
        const picker = makePicker(makeItems(2));
        const onAccept = vi.fn();
        picker.onAccept = onAccept;
        picker.validationMessage = "Heads up";
        picker.validationSeverity = "warning";

        press(picker, "Enter");
        expect(onAccept).toHaveBeenCalledOnce();
    });

    it("Escape отменяет", () => {
        const picker = makePicker([]);
        const onCancel = vi.fn();
        picker.onCancel = onCancel;

        press(picker, "Escape");
        expect(onCancel).toHaveBeenCalledOnce();
    });

    it("правка строки запроса даёт onQueryChange", () => {
        const picker = makePicker([]);
        const onQueryChange = vi.fn();
        picker.onQueryChange = onQueryChange;

        picker.inputElement.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "a" }));
        expect(onQueryChange).toHaveBeenCalledWith("a");
        expect(picker.getQuery()).toBe("a");
    });
});

describe("QuickPickElement — onActiveItemChanged", () => {
    it("файрится на навигации пользователя", () => {
        const picker = makePicker(makeItems(3));
        const onActive = vi.fn();
        picker.onActiveItemChanged = onActive;

        press(picker, "ArrowDown");
        expect(onActive).toHaveBeenCalledWith(expect.objectContaining({ label: "file-2.ts" }), 1);
    });

    // Контракт, на который опирается QuickInputService: программное
    // перепозиционирование он компенсирует своим notifyActive().
    it("молчит на items=, refreshItems и setActiveIndex", () => {
        const picker = makePicker(makeItems(3));
        const onActive = vi.fn();
        picker.onActiveItemChanged = onActive;

        picker.items = makeItems(5);
        expect(onActive).not.toHaveBeenCalled();

        picker.setActiveIndex(2);
        expect(onActive).not.toHaveBeenCalled();
        expect(picker.selectedIndex).toBe(2);

        picker.refreshItems(makeItems(6));
        expect(onActive).not.toHaveBeenCalled();
    });
});

describe("QuickPickElement — refreshItems", () => {
    it("держит курсор на прежнем предмете, когда список дорос", () => {
        const picker = makePicker(makeItems(3));
        press(picker, "ArrowDown");
        press(picker, "ArrowDown");
        expect(picker.selectedIndex).toBe(2);

        // Тот же список плюс новые элементы в хвосте.
        picker.refreshItems(makeItems(6));
        expect(picker.selectedIndex).toBe(2);
        expect(picker.items[picker.selectedIndex].label).toBe("file-3.ts");
    });

    it("клампит курсор, когда прежний предмет исчез", () => {
        const picker = makePicker(makeItems(5));
        press(picker, "ArrowDown");
        press(picker, "ArrowDown");
        press(picker, "ArrowDown");

        picker.refreshItems([{ label: "other.ts" }, { label: "another.ts" }]);
        expect(picker.selectedIndex).toBe(1);
    });

    it("пустой рефреш сбрасывает выделение", () => {
        const picker = makePicker(makeItems(3));
        press(picker, "ArrowDown");

        picker.refreshItems([]);
        expect(picker.selectedIndex).toBe(0);
        expect(picker.items).toHaveLength(0);
    });

    it("items= возвращает курсор наверх", () => {
        const picker = makePicker(makeItems(3));
        press(picker, "ArrowDown");
        expect(picker.selectedIndex).toBe(1);

        picker.items = makeItems(3);
        expect(picker.selectedIndex).toBe(0);
    });
});

describe("QuickPickElement — предметы", () => {
    it("предмет доезжает до onAccept целиком, вместе с чужими полями", () => {
        const item = { label: "main.ts", absolutePath: "/tmp/main.ts" };
        const picker = makePicker([item]);
        const onAccept = vi.fn();
        picker.onAccept = onAccept;

        press(picker, "Enter");
        expect(onAccept).toHaveBeenCalledWith(item, 0);
        expect(onAccept.mock.calls[0][0]).toBe(item);
    });

    it("setActiveIndex клампится в границы", () => {
        const picker = makePicker(makeItems(3));
        picker.setActiveIndex(99);
        expect(picker.selectedIndex).toBe(2);

        picker.setActiveIndex(-5);
        expect(picker.selectedIndex).toBe(0);
    });
});
