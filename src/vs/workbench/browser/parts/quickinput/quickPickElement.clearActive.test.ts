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

/** The highlight is only observable on the list: a cleared cursor shows up as its `isCursorCleared`. */
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
    if (list === undefined) throw new Error("picker has no list");
    return list;
}

const items = (...labels: string[]): QuickPickItem[] => labels.map((label) => ({ label }));

describe("QuickPickElement — no highlight (clearActive)", () => {
    it("clears the list cursor, and Enter accepts the typed value, not a row", () => {
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

    it("new rows for the same query do not bring the highlight back", () => {
        const picker = makePicker(items("a"));
        picker.clearActive();

        picker.refreshItems(items("x", "y"));

        expect(picker.inspectState()).toMatchObject({ items: ["x", "y"], activeIndex: -1 });
        expect(listOf(picker).isCursorCleared).toBe(true);
        expect(listOf(picker).rowCount).toBe(2);
    });

    it("with the highlight on the first row, a refresh looks for the previous item", () => {
        const picker = makePicker(items("b", "c"));

        picker.refreshItems(items("a", "b"));

        expect(picker.selectedIndex).toBe(1);
    });

    it("changing checks and width does not bring the highlight back", () => {
        const picker = makePicker(items("a", "b", "c"));
        picker.canPickMany = true;
        picker.clearActive();

        picker.setCheckedItems([picker.items[1]]);
        expect(listOf(picker).isCursorCleared).toBe(true);

        picker.preferredWidth = 40;
        layout(picker, 40);
        expect(listOf(picker).isCursorCleared).toBe(true);
    });

    it("with the highlight — even on the first row — the same rebuilds keep the cursor", () => {
        const picker = makePicker(items("a", "b", "c"));
        picker.canPickMany = true;

        picker.setCheckedItems([picker.items[0]]);
        expect(listOf(picker).isCursorCleared).toBe(false);

        picker.preferredWidth = 40;
        layout(picker, 40);
        expect(listOf(picker).isCursorCleared).toBe(false);
        expect(picker.selectedIndex).toBe(0);
    });

    it("Space without a highlight checks nothing", () => {
        const picker = makePicker(items("a", "b", "c"));
        picker.canPickMany = true;
        picker.clearActive();

        press(picker, " ");

        expect(picker.checkedItems.size).toBe(0);
    });

    it("↓ moves to the first row, ↑ to the last", () => {
        const picker = makePicker(items("a", "b", "c"));
        picker.clearActive();
        press(picker, "ArrowDown");
        expect(picker.selectedIndex).toBe(0);

        picker.clearActive();
        press(picker, "ArrowUp");
        expect(picker.selectedIndex).toBe(2);
    });
});

describe("QuickPickElement — PageDown near the end of the list", () => {
    it("moves to the last row when less than a page remains", () => {
        const picker = makePicker(items(...Array.from({ length: 30 }, (_, i) => `f${String(i)}`)));
        picker.setActiveIndex(27);

        press(picker, "PageDown");

        expect(picker.selectedIndex).toBe(29);
    });
});
