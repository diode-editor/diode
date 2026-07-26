import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../src/TestUtils/TestApp.ts";
import { Size } from "../../common/geometryPromitives.ts";
import { TUIKeyboardEvent } from "../../dom/events/tuiKeyboardEvent.ts";
import { TUIContextMenuEvent, TUIMouseEvent } from "../../dom/events/tuiMouseEvent.ts";
import { TextLabelElement } from "../text/textLabelElement.ts";

import { ListViewElement } from "./listViewElement.ts";

function makeRow(id: string): TextLabelElement {
    const row = new TextLabelElement(id);
    row.id = id;
    return row;
}

function key(list: ListViewElement, name: string): void {
    list.dispatchEvent(new TUIKeyboardEvent("keypress", { key: name }));
}

function createEmptyList(): { list: ListViewElement; app: TestApp } {
    const list = new ListViewElement();
    const app = TestApp.createWithContent(list, new Size(20, 5));
    list.focus();
    return { list, app };
}

describe("ListViewElement edge cases", () => {
    it("keyboard input on an empty list does not crash or fire callbacks", () => {
        const { list, app } = createEmptyList();
        const onActivate = vi.fn();
        const onSelect = vi.fn();
        list.onActivate = onActivate;
        list.onSelect = onSelect;

        for (const name of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", " ", "Home", "End", "PageUp", "PageDown"]) {
            key(list, name);
        }
        app.render();

        expect(onActivate).not.toHaveBeenCalled();
        expect(onSelect).not.toHaveBeenCalled();
        expect(list.getCursorElement()).toBeNull();
        expect(list.getSelectedElements()).toEqual([]);
    });

    it("unbound keys fall through to the base default action", () => {
        const { list } = createEmptyList();
        // Событие не из карты списка и не typeahead — уходит в super (без падения).
        list.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "x" }));
        expect(list.getCursorElement()).toBeNull();
    });

    it("clicks on an empty list are no-ops", () => {
        const { list } = createEmptyList();
        const onContextMenu = vi.fn();
        list.onContextMenu = onContextMenu;
        list.dispatchEvent(
            new TUIContextMenuEvent({
                trigger: "mouse",
                button: "right",
                localX: 0,
                localY: 0,
                screenX: 0,
                screenY: 0,
            }),
        );
        expect(onContextMenu).not.toHaveBeenCalled();

        // Клавиатурный триггер на пустом списке — тоже no-op.
        list.dispatchEvent(
            new TUIContextMenuEvent({
                trigger: "keyboard",
                button: "none",
                localX: 0,
                localY: 0,
                screenX: 0,
                screenY: 0,
            }),
        );
        expect(onContextMenu).not.toHaveBeenCalled();
    });

    it("mousedown focuses the list (base default action)", () => {
        const list = new ListViewElement();
        list.appendRow(makeRow("a"));
        const app = TestApp.createWithContent(list, new Size(20, 5));
        expect(app.focusedElement).not.toBe(list);
        list.dispatchEvent(new TUIMouseEvent("mousedown", { button: "left", localX: 0, localY: 0, screenX: 0, screenY: 0 }));
        expect(app.focusedElement).toBe(list);
    });

    it("appendRow after clear starts from a clean state", () => {
        const list = new ListViewElement();
        list.appendRow(makeRow("a"));
        list.appendRow(makeRow("a1"), { parentId: "a" });
        list.clear();
        // Прежние id снова свободны, прежние parentId — уже нет.
        list.appendRow(makeRow("a"));
        expect(() => list.appendRow(makeRow("x"), { parentId: "a1" })).toThrow(/unknown parentId/);
        expect(list.rowCount).toBe(1);
    });

    it("hover state survives rows disappearing under the pointer", () => {
        const list = new ListViewElement();
        for (let i = 0; i < 5; i++) list.appendRow(makeRow(`r${i}`));
        const app = TestApp.createWithContent(list, new Size(20, 10));
        list.dispatchEvent(new TUIMouseEvent("mousemove", { button: "none" as never, localX: 0, localY: 4, screenX: 0, screenY: 4 }));
        for (let i = 0; i < 4; i++) list.setRowHidden(`r${i}`, true);
        app.render(); // hover-индекс за пределами проекции — рендер не падает

        list.dispatchEvent(new TUIMouseEvent("mouseleave", { button: "none" as never, localX: 0, localY: 0, screenX: 0, screenY: 0 }));
        app.render();
        expect(list.contentHeight).toBe(1);
    });

    it("scrollTo clamps within the visible content", () => {
        const list = new ListViewElement();
        for (let i = 0; i < 10; i++) list.appendRow(makeRow(`r${i}`));
        TestApp.createWithContent(list, new Size(20, 5));
        list.scrollBy(0, 100);
        expect(list.scrollTop).toBe(5);
        list.scrollBy(0, -100);
        expect(list.scrollTop).toBe(0);
    });
});
