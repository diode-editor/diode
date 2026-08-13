import { describe, expect, it } from "vitest";

import { TestApp } from "../../testing/TestApp.ts";
import { Size } from "../../common/geometryPromitives.ts";
import { TUIKeyboardEvent } from "../../dom/events/tuiKeyboardEvent.ts";
import { TUIMouseEvent } from "../../dom/events/tuiMouseEvent.ts";
import { TextLabelElement } from "../text/textLabelElement.ts";

import { ListViewElement } from "./listViewElement.ts";

function makeRow(id: string): TextLabelElement {
    const row = new TextLabelElement(id);
    row.id = id;
    return row;
}

function createList(count = 5): ListViewElement {
    const list = new ListViewElement();
    for (let i = 0; i < count; i++) list.appendRow(makeRow(`r${i}`));
    TestApp.createWithContent(list, new Size(20, 10));
    list.focus();
    return list;
}

function click(list: ListViewElement, row: number, mods: { ctrlKey?: boolean; shiftKey?: boolean } = {}): void {
    list.dispatchEvent(
        new TUIMouseEvent("click", {
            button: "left",
            screenX: 5,
            screenY: row,
            localX: 5,
            localY: row,
            ctrlKey: mods.ctrlKey,
            shiftKey: mods.shiftKey,
        }),
    );
}

function key(list: ListViewElement, name: string, shiftKey = false): void {
    list.dispatchEvent(new TUIKeyboardEvent("keypress", { key: name, shiftKey }));
}

function selectedIds(list: ListViewElement): (string | undefined)[] {
    return list.getSelectedElements().map((el) => el.id);
}

describe("ListViewElement multi-selection", () => {
    it("returns the cursor row as a single-element selection by default", () => {
        const list = createList();
        click(list, 2);
        expect(selectedIds(list)).toEqual(["r2"]);
        expect(list.getCursorElement()?.id).toBe("r2");
    });

    it("Shift+ArrowDown extends the selection range from the anchor", () => {
        const list = createList();
        key(list, "ArrowDown", true);
        key(list, "ArrowDown", true);
        expect(selectedIds(list)).toEqual(["r0", "r1", "r2"]);
    });

    it("Shift+ArrowUp shrinks the range back towards the anchor", () => {
        const list = createList();
        key(list, "ArrowDown", true);
        key(list, "ArrowDown", true);
        key(list, "ArrowUp", true);
        expect(selectedIds(list)).toEqual(["r0", "r1"]);
    });

    it("a plain arrow key resets the multi-selection", () => {
        const list = createList();
        key(list, "ArrowDown", true);
        expect(selectedIds(list)).toEqual(["r0", "r1"]);
        key(list, "ArrowDown");
        expect(selectedIds(list)).toEqual(["r2"]);
    });

    it("Ctrl+click adds the current cursor first, then toggles rows", () => {
        const list = createList();
        click(list, 3, { ctrlKey: true });
        expect(selectedIds(list)).toEqual(["r0", "r3"]);
        click(list, 3, { ctrlKey: true });
        expect(selectedIds(list)).toEqual(["r0"]);
    });

    it("Shift+click selects the range from the anchor", () => {
        const list = createList();
        click(list, 1);
        click(list, 4, { shiftKey: true });
        expect(selectedIds(list)).toEqual(["r1", "r2", "r3", "r4"]);
    });

    it("getSelectedElements returns rows in list order regardless of click order", () => {
        const list = createList();
        click(list, 3, { ctrlKey: true });
        click(list, 1, { ctrlKey: true });
        expect(selectedIds(list)).toEqual(["r0", "r1", "r3"]);
    });

    it("Shift+arrows clamp at both edges without losing the selection", () => {
        const list = createList(3);
        key(list, "ArrowUp", true); // уже на первой строке
        expect(selectedIds(list)).toEqual(["r0"]);
        key(list, "ArrowDown", true);
        key(list, "ArrowDown", true);
        key(list, "ArrowDown", true); // кламп на последней
        expect(selectedIds(list)).toEqual(["r0", "r1", "r2"]);
    });

    it("Shift+arrow on an empty list is a no-op", () => {
        const list = new ListViewElement();
        TestApp.createWithContent(list, new Size(20, 5));
        list.focus();
        key(list, "ArrowDown", true);
        expect(list.getSelectedElements()).toEqual([]);
    });

    it("selection anchored across a collapse follows the projection rebuild", () => {
        const list = new ListViewElement();
        list.appendRow(makeRow("file1"));
        list.appendRow(makeRow("m1"), { parentId: "file1" });
        list.appendRow(makeRow("file2"));
        TestApp.createWithContent(list, new Size(20, 10));
        list.focus();

        key(list, "ArrowDown"); // m1
        list.setCollapsed("file1", true);
        // Курсорная строка свернулась — курсор садится на ближайшую (file2 теперь на её индексе).
        expect(list.getCursorElement()?.id).toBe("file2");
    });
});
