import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../testing/TestApp.ts";
import { Size } from "../../common/geometryPromitives.ts";
import { TUIKeyboardEvent } from "../../dom/events/tuiKeyboardEvent.ts";
import { TextLabelElement } from "../text/textLabelElement.ts";

import { ListViewElement } from "./listViewElement.ts";

function makeRow(id: string, text = id): TextLabelElement {
    const row = new TextLabelElement(text);
    row.id = id;
    return row;
}

function key(list: ListViewElement, name: string, shiftKey = false): void {
    list.dispatchEvent(new TUIKeyboardEvent("keypress", { key: name, shiftKey }));
}

function createFlatList(count = 10, height = 5): { list: ListViewElement; app: TestApp } {
    const list = new ListViewElement();
    for (let i = 0; i < count; i++) list.appendRow(makeRow(`r${i}`, `row ${i}`));
    const app = TestApp.createWithContent(list, new Size(20, height));
    list.focus();
    return { list, app };
}

function createGroupedList(): { list: ListViewElement; app: TestApp } {
    const list = new ListViewElement();
    list.appendRow(makeRow("file1"));
    list.appendRow(makeRow("m1"), { parentId: "file1" });
    list.appendRow(makeRow("m2"), { parentId: "file1" });
    list.appendRow(makeRow("file2"));
    list.appendRow(makeRow("m3"), { parentId: "file2" });
    const app = TestApp.createWithContent(list, new Size(20, 10));
    list.focus();
    return { list, app };
}

function cursorId(list: ListViewElement): unknown {
    return list.inspectState().cursorId;
}

describe("ListViewElement navigation", () => {
    it("arrow keys move the cursor and clamp at the edges", () => {
        const { list } = createFlatList(3);
        key(list, "ArrowUp");
        expect(cursorId(list)).toBe("r0");
        key(list, "ArrowDown");
        expect(cursorId(list)).toBe("r1");
        key(list, "ArrowDown");
        key(list, "ArrowDown");
        key(list, "ArrowDown");
        expect(cursorId(list)).toBe("r2");
    });

    it("fires onSelect when the cursor moves", () => {
        const { list } = createFlatList(3);
        const onSelect = vi.fn();
        list.onSelect = onSelect;
        key(list, "ArrowDown");
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect((onSelect.mock.calls[0][0] as TextLabelElement).id).toBe("r1");
    });

    it("keyboard navigation scrolls the cursor into view both ways", () => {
        const { list } = createFlatList(20, 5);
        for (let i = 0; i < 9; i++) key(list, "ArrowDown");
        expect(cursorId(list)).toBe("r9");
        expect(list.scrollTop).toBe(5); // 9 - 5 + 1

        for (let i = 0; i < 9; i++) key(list, "ArrowUp");
        expect(cursorId(list)).toBe("r0");
        expect(list.scrollTop).toBe(0);
    });

    it("PageDown/PageUp jump by a viewport page, Home/End to the ends", () => {
        const { list } = createFlatList(20, 5);
        key(list, "PageDown");
        expect(cursorId(list)).toBe("r4");
        key(list, "PageUp");
        expect(cursorId(list)).toBe("r0");
        key(list, "End");
        expect(cursorId(list)).toBe("r19");
        key(list, "Home");
        expect(cursorId(list)).toBe("r0");
    });

    it("Enter activates the cursor row", () => {
        const { list } = createFlatList(3);
        const onActivate = vi.fn();
        list.onActivate = onActivate;
        key(list, "ArrowDown");
        key(list, "Enter");
        expect(onActivate).toHaveBeenCalledTimes(1);
        expect((onActivate.mock.calls[0][0] as TextLabelElement).id).toBe("r1");
    });

    it("Space toggles collapse on a parent row and is a no-op on a leaf", () => {
        const { list } = createGroupedList();
        key(list, " ");
        expect(list.isCollapsed("file1")).toBe(true);
        key(list, " ");
        expect(list.isCollapsed("file1")).toBe(false);

        key(list, "ArrowDown"); // m1 — лист
        key(list, " ");
        expect(list.isCollapsed("m1")).toBe(false);
    });

    it("ArrowRight expands a collapsed parent, then moves to the first child", () => {
        const { list } = createGroupedList();
        list.setCollapsed("file1", true);
        key(list, "ArrowRight");
        expect(list.isCollapsed("file1")).toBe(false);
        expect(cursorId(list)).toBe("file1");
        key(list, "ArrowRight");
        expect(cursorId(list)).toBe("m1");
        // На листе ArrowRight — no-op.
        key(list, "ArrowRight");
        expect(cursorId(list)).toBe("m1");
    });

    it("ArrowLeft collapses an expanded parent, from a child jumps to the parent", () => {
        const { list } = createGroupedList();
        key(list, "ArrowDown"); // m1
        key(list, "ArrowLeft");
        expect(cursorId(list)).toBe("file1");
        key(list, "ArrowLeft");
        expect(list.isCollapsed("file1")).toBe(true);
        // Свёрнутый top-level: идти некуда.
        key(list, "ArrowLeft");
        expect(cursorId(list)).toBe("file1");
    });

    it("ArrowRight on an expanded parent without visible children stays put", () => {
        const list = new ListViewElement();
        list.appendRow(makeRow("p"));
        list.appendRow(makeRow("k"), { parentId: "p" });
        TestApp.createWithContent(list, new Size(20, 5));
        list.focus();
        list.setRowHidden("k", true);
        key(list, "ArrowRight");
        expect(cursorId(list)).toBe("p");
    });

    it("setCursorTo on a hidden row leaves the cursor unchanged", () => {
        const { list } = createFlatList(5);
        list.setRowHidden("r3", true);
        list.setCursorTo("r3");
        expect(cursorId(list)).toBe("r0");
    });

    it("public focus helpers mirror the keyboard behaviour", () => {
        const { list } = createFlatList(20, 5);
        list.focusPageDown();
        expect(cursorId(list)).toBe("r4");
        list.focusLast();
        expect(cursorId(list)).toBe("r19");
        list.focusPageUp();
        expect(cursorId(list)).toBe("r15");
        list.focusFirst();
        expect(cursorId(list)).toBe("r0");
    });
});
