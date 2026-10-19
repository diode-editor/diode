import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { describe, expect, it, vi } from "vitest";

import type { QuickPickItem } from "../../../common/quickPickItem.ts";

import { QuickPickElement } from "./quickPickElement.ts";

function layout(picker: QuickPickElement, width = 30): void {
    picker.layout(BoxConstraints.tight(new Size(width, picker.getMinIntrinsicHeight(width))));
}

function makePicker(items: QuickPickItem[]): QuickPickElement {
    const picker = new QuickPickElement();
    picker.preferredWidth = 30;
    picker.items = items;
    layout(picker);
    return picker;
}

function press(picker: QuickPickElement, key: string): void {
    picker.dispatchEvent(new TUIKeyboardEvent("keydown", { key }));
}

/** Подсветка видна только на списке: снятый курсор — это его `isCursorCleared`. */
function findList(element: TUIElement): ListViewElement | undefined {
    if (element instanceof ListViewElement) return element;
    for (const child of element.getChildren()) {
        const found = findList(child);
        if (found !== undefined) return found;
    }
    return undefined;
}

function listOf(picker: QuickPickElement): ListViewElement {
    const list = findList(picker);
    if (list === undefined) throw new Error("в пикере нет списка");
    return list;
}

const items = (...labels: string[]): QuickPickItem[] => labels.map((label) => ({ label }));

describe("QuickPickElement — без подсветки (clearActive)", () => {
    it("снимает курсор списка, и Enter принимает набранное, а не строку", () => {
        const picker = makePicker(items("a", "b", "c"));
        const onAccept = vi.fn();
        const onAcceptEmpty = vi.fn();
        picker.onAccept = onAccept;
        picker.onAcceptEmpty = onAcceptEmpty;

        picker.clearActive();
        press(picker, "Enter");

        expect(picker.selectedIndex).toBe(-1);
        expect(listOf(picker).isCursorCleared).toBe(true);
        expect(onAcceptEmpty).toHaveBeenCalledOnce();
        expect(onAccept).not.toHaveBeenCalled();
    });

    it("новые строки того же запроса подсветку не возвращают", () => {
        const picker = makePicker(items("a"));
        picker.clearActive();

        picker.refreshItems(items("x", "y"));

        expect(picker.inspectState()).toMatchObject({ items: ["x", "y"], activeIndex: -1 });
        expect(listOf(picker).isCursorCleared).toBe(true);
        expect(listOf(picker).rowCount).toBe(2);
    });

    it("с подсветкой на первой строке обновление ищет прежний предмет", () => {
        const picker = makePicker(items("b", "c"));

        picker.refreshItems(items("a", "b"));

        expect(picker.selectedIndex).toBe(1);
    });

    it("смена отметок и ширины подсветку не возвращают", () => {
        const picker = makePicker(items("a", "b", "c"));
        picker.canPickMany = true;
        picker.clearActive();

        picker.setCheckedItems([picker.items[1]]);
        expect(listOf(picker).isCursorCleared).toBe(true);

        picker.preferredWidth = 40;
        layout(picker, 40);
        expect(listOf(picker).isCursorCleared).toBe(true);
    });

    it("с подсветкой — и на первой строке — те же пересборки курсор не снимают", () => {
        const picker = makePicker(items("a", "b", "c"));
        picker.canPickMany = true;

        picker.setCheckedItems([picker.items[0]]);
        expect(listOf(picker).isCursorCleared).toBe(false);

        picker.preferredWidth = 40;
        layout(picker, 40);
        expect(listOf(picker).isCursorCleared).toBe(false);
        expect(picker.selectedIndex).toBe(0);
    });

    it("Space без подсветки ничего не отмечает", () => {
        const picker = makePicker(items("a", "b", "c"));
        picker.canPickMany = true;
        picker.clearActive();

        press(picker, " ");

        expect(picker.checkedItems.size).toBe(0);
    });

    it("↓ встаёт на первую строку, ↑ — на последнюю", () => {
        const picker = makePicker(items("a", "b", "c"));
        picker.clearActive();
        press(picker, "ArrowDown");
        expect(picker.selectedIndex).toBe(0);

        picker.clearActive();
        press(picker, "ArrowUp");
        expect(picker.selectedIndex).toBe(2);
    });
});

describe("QuickPickElement — PageDown у конца списка", () => {
    it("встаёт на последнюю строку, когда до конца меньше окна", () => {
        const picker = makePicker(items(...Array.from({ length: 30 }, (_, i) => `f${String(i)}`)));
        picker.setActiveIndex(27);

        press(picker, "PageDown");

        expect(picker.selectedIndex).toBe(29);
    });
});
