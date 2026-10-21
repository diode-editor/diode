import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { describe, expect, it, vi } from "vitest";

import type { QuickPickItem } from "../../../common/quickPickItem.ts";

import { QuickPickElement } from "./quickPickElement.ts";

function makePicker(items: QuickPickItem[] = []): QuickPickElement {
    const picker = new QuickPickElement();
    picker.preferredWidth = 30;
    picker.items = items;
    // Without a layout pass, navigation has no geometry to scroll to.
    picker.layout(BoxConstraints.tight(new Size(30, picker.getMinIntrinsicHeight(30))));
    return picker;
}

function press(picker: QuickPickElement, key: string): void {
    picker.dispatchEvent(new TUIKeyboardEvent("keydown", { key }));
}

function makeItems(count: number): QuickPickItem[] {
    return Array.from({ length: count }, (_, i) => ({ label: `file-${String(i + 1)}.ts` }));
}

describe("QuickPickElement — keyboard", () => {
    it("arrow keys move the selection without wrapping", () => {
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

    it("PageDown/PageUp move by one list page", () => {
        const picker = makePicker(makeItems(30));
        press(picker, "PageDown");
        expect(picker.selectedIndex).toBe(picker.maxVisibleItems);

        press(picker, "PageUp");
        expect(picker.selectedIndex).toBe(0);
    });

    it("Enter in item mode returns the selected item", () => {
        const picker = makePicker(makeItems(3));
        const onAccept = vi.fn();
        picker.onAccept = onAccept;

        press(picker, "ArrowDown");
        press(picker, "Enter");

        expect(onAccept).toHaveBeenCalledWith(expect.objectContaining({ label: "file-2.ts" }), 1);
    });

    it("Enter on an empty list in item mode does nothing", () => {
        const picker = makePicker([]);
        const onAccept = vi.fn();
        picker.onAccept = onAccept;

        press(picker, "Enter");
        expect(onAccept).not.toHaveBeenCalled();
    });

    it("Enter in value mode returns the query text", () => {
        const picker = makePicker([]);
        picker.acceptMode = "value";
        const onAcceptValue = vi.fn();
        picker.onAcceptValue = onAcceptValue;
        picker.setQuery("note.txt");

        press(picker, "Enter");
        expect(onAcceptValue).toHaveBeenCalledWith("note.txt");
    });

    it("a hard validation error blocks Enter in both modes", () => {
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

    it("a warning does not block Enter", () => {
        const picker = makePicker(makeItems(2));
        const onAccept = vi.fn();
        picker.onAccept = onAccept;
        picker.validationMessage = "Heads up";
        picker.validationSeverity = "warning";

        press(picker, "Enter");
        expect(onAccept).toHaveBeenCalledOnce();
    });

    it("Escape cancels", () => {
        const picker = makePicker([]);
        const onCancel = vi.fn();
        picker.onCancel = onCancel;

        press(picker, "Escape");
        expect(onCancel).toHaveBeenCalledOnce();
    });

    it("editing the query row fires onQueryChange", () => {
        const picker = makePicker([]);
        const onQueryChange = vi.fn();
        picker.onQueryChange = onQueryChange;

        picker.inputElement.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "a" }));
        expect(onQueryChange).toHaveBeenCalledWith("a");
        expect(picker.getQuery()).toBe("a");
    });
});

describe("QuickPickElement — onActiveItemChanged", () => {
    it("fires on user navigation", () => {
        const picker = makePicker(makeItems(3));
        const onActive = vi.fn();
        picker.onActiveItemChanged = onActive;

        press(picker, "ArrowDown");
        expect(onActive).toHaveBeenCalledWith(expect.objectContaining({ label: "file-2.ts" }), 1);
    });

    // QuickInputService relies on this contract: it covers programmatic repositioning
    // with its own notifyActive().
    it("stays silent on items=, refreshItems and setActiveIndex", () => {
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
    it("keeps the cursor on the previous item when the list grows", () => {
        const picker = makePicker(makeItems(3));
        press(picker, "ArrowDown");
        press(picker, "ArrowDown");
        expect(picker.selectedIndex).toBe(2);

        picker.refreshItems(makeItems(6));
        expect(picker.selectedIndex).toBe(2);
        expect(picker.items[picker.selectedIndex].label).toBe("file-3.ts");
    });

    it("clamps the cursor when the previous item is gone", () => {
        const picker = makePicker(makeItems(5));
        press(picker, "ArrowDown");
        press(picker, "ArrowDown");
        press(picker, "ArrowDown");

        picker.refreshItems([{ label: "other.ts" }, { label: "another.ts" }]);
        expect(picker.selectedIndex).toBe(1);
    });

    it("an empty refresh resets the selection", () => {
        const picker = makePicker(makeItems(3));
        press(picker, "ArrowDown");

        picker.refreshItems([]);
        expect(picker.selectedIndex).toBe(0);
        expect(picker.items).toHaveLength(0);
    });

    it("items= moves the cursor back to the top", () => {
        const picker = makePicker(makeItems(3));
        press(picker, "ArrowDown");
        expect(picker.selectedIndex).toBe(1);

        picker.items = makeItems(3);
        expect(picker.selectedIndex).toBe(0);
    });
});

describe("QuickPickElement — empty list", () => {
    it("arrow keys on an empty list do nothing", () => {
        const picker = makePicker([]);
        press(picker, "ArrowDown");
        press(picker, "ArrowUp");
        expect(picker.selectedIndex).toBe(0);
    });

    it("setActiveIndex on an empty list does nothing", () => {
        const picker = makePicker([]);
        picker.setActiveIndex(3);
        expect(picker.selectedIndex).toBe(0);
    });

    it("refreshItems from an empty start takes the first item", () => {
        const picker = makePicker([]);
        picker.refreshItems(makeItems(3));
        expect(picker.selectedIndex).toBe(0);
        expect(picker.items).toHaveLength(3);
    });
});

describe("QuickPickElement — items", () => {
    it("the item reaches onAccept whole, including foreign fields", () => {
        const item = { label: "main.ts", absolutePath: "/tmp/main.ts" };
        const picker = makePicker([item]);
        const onAccept = vi.fn();
        picker.onAccept = onAccept;

        press(picker, "Enter");
        expect(onAccept).toHaveBeenCalledWith(item, 0);
        expect(onAccept.mock.calls[0][0]).toBe(item);
    });

    it("setActiveIndex is clamped to bounds", () => {
        const picker = makePicker(makeItems(3));
        picker.setActiveIndex(99);
        expect(picker.selectedIndex).toBe(2);

        picker.setActiveIndex(-5);
        expect(picker.selectedIndex).toBe(0);
    });
});
