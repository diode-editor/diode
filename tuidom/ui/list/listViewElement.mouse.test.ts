import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../testing/TestApp.ts";
import { Size } from "../../common/geometryPromitives.ts";
import { TUIContextMenuEvent, TUIMouseEvent } from "../../dom/events/tuiMouseEvent.ts";
import { TextLabelElement } from "../text/textLabelElement.ts";

import { ListViewElement } from "./listViewElement.ts";

function makeRow(id: string): TextLabelElement {
    const row = new TextLabelElement(id);
    row.id = id;
    return row;
}

function mouse(
    list: ListViewElement,
    type: "click" | "dblclick" | "wheel" | "mousemove" | "contextmenu",
    init: {
        localX?: number;
        localY?: number;
        button?: "left" | "right";
        ctrlKey?: boolean;
        shiftKey?: boolean;
        wheelDirection?: "up" | "down" | "left" | "right";
    } = {},
): void {
    if (type === "contextmenu") {
        list.dispatchEvent(
            new TUIContextMenuEvent({
                trigger: "mouse",
                button: "right",
                screenX: 10 + (init.localX ?? 0),
                screenY: 20 + (init.localY ?? 0),
                localX: init.localX ?? 0,
                localY: init.localY ?? 0,
            }),
        );
        return;
    }
    list.dispatchEvent(
        new TUIMouseEvent(type, {
            button: init.button ?? "left",
            screenX: 10 + (init.localX ?? 0),
            screenY: 20 + (init.localY ?? 0),
            localX: init.localX ?? 0,
            localY: init.localY ?? 0,
            ctrlKey: init.ctrlKey,
            shiftKey: init.shiftKey,
            wheelDirection: init.wheelDirection,
        }),
    );
}

function createGroupedList(): ListViewElement {
    const list = new ListViewElement();
    list.appendRow(makeRow("file1"));
    list.appendRow(makeRow("m1"), { parentId: "file1" });
    list.appendRow(makeRow("m2"), { parentId: "file1" });
    list.appendRow(makeRow("file2"));
    list.appendRow(makeRow("m3"), { parentId: "file2" });
    TestApp.createWithContent(list, new Size(20, 10));
    list.focus();
    return list;
}

function createFlatList(count = 10): ListViewElement {
    const list = new ListViewElement();
    for (let i = 0; i < count; i++) list.appendRow(makeRow(`r${i}`));
    TestApp.createWithContent(list, new Size(20, 5));
    list.focus();
    return list;
}

describe("ListViewElement mouse", () => {
    it("click moves the cursor to the clicked row", () => {
        const list = createFlatList();
        mouse(list, "click", { localX: 5, localY: 3 });
        expect(list.getCursorElement()?.id).toBe("r3");
    });

    it("click accounts for the scroll position", () => {
        const list = createFlatList(20);
        list.scrollBy(0, 10);
        mouse(list, "click", { localX: 5, localY: 2 });
        expect(list.getCursorElement()?.id).toBe("r12");
    });

    it("click below the content is a no-op", () => {
        const list = createFlatList(2);
        mouse(list, "click", { localX: 5, localY: 4 });
        expect(list.getCursorElement()?.id).toBe("r0");
    });

    it("click on the chevron column toggles collapse", () => {
        const list = createGroupedList();
        mouse(list, "click", { localX: 0, localY: 0 });
        expect(list.isCollapsed("file1")).toBe(true);
        mouse(list, "click", { localX: 1, localY: 0 });
        expect(list.isCollapsed("file1")).toBe(false);
        // Клик правее шеврона не сворачивает.
        mouse(list, "click", { localX: 5, localY: 0 });
        expect(list.isCollapsed("file1")).toBe(false);
    });

    it("mouse contextmenu fires onContextMenu with screen coordinates", () => {
        const list = createFlatList();
        const onContextMenu = vi.fn();
        list.onContextMenu = onContextMenu;
        mouse(list, "contextmenu", { localX: 4, localY: 2 });

        expect(list.getCursorElement()?.id).toBe("r2");
        expect(onContextMenu).toHaveBeenCalledTimes(1);
        const [element, screenX, screenY] = onContextMenu.mock.calls[0] as [TextLabelElement, number, number];
        expect(element.id).toBe("r2");
        expect(screenX).toBe(14);
        expect(screenY).toBe(22);
    });

    it("right click on a multi-selected row keeps the selection", () => {
        const list = createFlatList();
        mouse(list, "click", { localX: 0, localY: 1 });
        mouse(list, "click", { localX: 0, localY: 3, ctrlKey: true });
        mouse(list, "contextmenu", { localX: 0, localY: 3 });

        expect(list.getSelectedElements().map((el) => el.id)).toEqual(["r1", "r3"]);
        expect(list.getCursorElement()?.id).toBe("r3");
    });

    it("a raw right-button click is ignored (contextmenu carries the gesture)", () => {
        const list = createFlatList();
        const onContextMenu = vi.fn();
        list.onContextMenu = onContextMenu;
        mouse(list, "click", { localX: 0, localY: 1 }); // курсор на r1

        mouse(list, "click", { button: "right", localX: 0, localY: 3 });

        expect(onContextMenu).not.toHaveBeenCalled();
        expect(list.getCursorElement()?.id).toBe("r1"); // курсор не сдвинулся
    });

    it("keyboard contextmenu anchors at the cursor row", () => {
        const list = createFlatList();
        const onContextMenu = vi.fn();
        list.onContextMenu = onContextMenu;
        mouse(list, "click", { localX: 0, localY: 2 }); // курсор на r2

        list.dispatchEvent(
            new TUIContextMenuEvent({
                trigger: "keyboard",
                button: "none",
                screenX: 0,
                screenY: 0,
                localX: 0,
                localY: 0,
            }),
        );

        expect(onContextMenu).toHaveBeenCalledTimes(1);
        const [element, screenX, screenY] = onContextMenu.mock.calls[0] as [TextLabelElement, number, number];
        expect(element.id).toBe("r2");
        expect(screenX).toBe(list.globalPosition.x);
        expect(screenY).toBe(list.globalPosition.y + 2);
    });

    it("right click on an unselected row resets the multi-selection", () => {
        const list = createFlatList();
        mouse(list, "click", { localX: 0, localY: 3, ctrlKey: true });
        mouse(list, "contextmenu", { localX: 0, localY: 1 });
        expect(list.getSelectedElements().map((el) => el.id)).toEqual(["r1"]);
    });

    it("dblclick toggles a parent row and activates a leaf", () => {
        const list = createGroupedList();
        const onActivate = vi.fn();
        list.onActivate = onActivate;

        mouse(list, "dblclick", { localX: 5, localY: 0 });
        expect(list.isCollapsed("file1")).toBe(true);
        expect(onActivate).not.toHaveBeenCalled();

        mouse(list, "dblclick", { localX: 5, localY: 1 }); // file2 после сворачивания? нет: file1 свернулся, вторая строка — file2
        expect(list.isCollapsed("file2")).toBe(true);

        list.setCollapsed("file2", false);
        mouse(list, "dblclick", { localX: 5, localY: 2 }); // m3 — лист
        expect(onActivate).toHaveBeenCalledTimes(1);
        expect((onActivate.mock.calls[0][0] as TextLabelElement).id).toBe("m3");
    });

    it("dblclick below the content is a no-op", () => {
        const list = createFlatList(2);
        const onActivate = vi.fn();
        list.onActivate = onActivate;
        mouse(list, "dblclick", { localX: 0, localY: 4 });
        expect(onActivate).not.toHaveBeenCalled();
    });

    it("wheel scrolls by three rows, horizontal directions are ignored", () => {
        const list = createFlatList(20);
        mouse(list, "wheel", { wheelDirection: "down" });
        expect(list.scrollTop).toBe(3);
        mouse(list, "wheel", { wheelDirection: "left" });
        expect(list.scrollTop).toBe(3);
        mouse(list, "wheel", { wheelDirection: "up" });
        expect(list.scrollTop).toBe(0);
    });

    it("mouseleave without an active hover is a no-op", () => {
        const list = createFlatList();
        list.dispatchEvent(
            new TUIMouseEvent("mouseleave", { button: "left", localX: 0, localY: 0, screenX: 0, screenY: 0 }),
        );
        expect(list.getCursorElement()?.id).toBe("r0");
    });

    it("mousemove over the same row does not re-mark hover", () => {
        const list = createFlatList();
        mouse(list, "mousemove", { localX: 1, localY: 2 });
        mouse(list, "mousemove", { localX: 3, localY: 2 });
        // Второй move по той же строке не меняет hover — проверяем отсутствием падения
        // и стабильным состоянием курсора.
        expect(list.getCursorElement()?.id).toBe("r0");
    });
});
