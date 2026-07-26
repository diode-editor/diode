import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../src/TestUtils/TestApp.ts";
import { Size } from "../../common/geometryPromitives.ts";
import { TUIMouseEvent } from "../../dom/events/tuiMouseEvent.ts";
import { HFlexElement, hflexFill, hflexFixed } from "../layout/hFlexElement.ts";
import { TextLabelElement } from "../text/textLabelElement.ts";

import { ListViewElement } from "./listViewElement.ts";

// Строка «имя (fill) + глиф-кнопка (fixed 2)»: глиф потребляет click/dblclick
// через preventDefault — контракт делегации из doc-комментария ListViewElement.
function makeButtonRow(id: string, onButton: () => void): HFlexElement {
    const row = new HFlexElement();
    row.id = id;
    const name = new TextLabelElement(id);
    const button = new TextLabelElement("");
    button.addEventListener("click", (event) => {
        event.preventDefault();
        onButton();
    });
    button.addEventListener("dblclick", (event) => {
        event.preventDefault();
    });
    row.addChild(name, { width: hflexFill(), height: 1 });
    row.addChild(button, { width: hflexFixed(2), height: 1 });
    return row;
}

function makePlainRow(id: string): TextLabelElement {
    const row = new TextLabelElement(id);
    row.id = id;
    return row;
}

// TestApp кладёт контент в (0,0) на весь экран, поэтому screen-координаты
// совпадают с local-координатами списка — делегация хит-тестит по screenX/Y.
function mouse(
    list: ListViewElement,
    type: "click" | "dblclick",
    init: { x: number; y: number; button?: "left" | "right"; ctrlKey?: boolean; shiftKey?: boolean },
): void {
    list.dispatchEvent(
        new TUIMouseEvent(type, {
            button: init.button ?? "left",
            screenX: init.x,
            screenY: init.y,
            localX: init.x,
            localY: init.y,
            ctrlKey: init.ctrlKey,
            shiftKey: init.shiftKey,
        }),
    );
}

const WIDTH = 20;
const BUTTON_X = WIDTH - 2;

function createList(onButton: () => void): { list: ListViewElement; app: TestApp } {
    const list = new ListViewElement();
    for (let i = 0; i < 5; i++) list.appendRow(makeButtonRow(`r${i}`, onButton));
    const app = TestApp.createWithContent(list, new Size(WIDTH, 10));
    list.focus();
    return { list, app };
}

describe("ListViewElement click delegation", () => {
    it("click on a consuming child fires its listener and leaves cursor/selection alone", () => {
        const onButton = vi.fn();
        const onSelect = vi.fn();
        const { list } = createList(onButton);
        list.onSelect = onSelect;

        mouse(list, "click", { x: BUTTON_X, y: 3 });

        expect(onButton).toHaveBeenCalledTimes(1);
        // Курсор и неявное выделение остаются на прежней строке.
        expect(list.getCursorElement()?.id).toBe("r0");
        expect(list.getSelectedElements().map((el) => el.id)).toEqual(["r0"]);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it("click on a non-consuming child falls back to row selection", () => {
        const onButton = vi.fn();
        const { list } = createList(onButton);

        mouse(list, "click", { x: 2, y: 3 }); // имя строки — listener'ов нет

        expect(onButton).not.toHaveBeenCalled();
        expect(list.getCursorElement()?.id).toBe("r3");
    });

    it("dblclick over a consuming child does not activate the row", () => {
        const onButton = vi.fn();
        const onActivate = vi.fn();
        const { list } = createList(onButton);
        list.onActivate = onActivate;

        mouse(list, "dblclick", { x: BUTTON_X, y: 2 });

        expect(onActivate).not.toHaveBeenCalled();
    });

    it("dblclick outside consuming children still activates the row", () => {
        const onActivate = vi.fn();
        const { list } = createList(() => undefined);
        list.onActivate = onActivate;

        mouse(list, "dblclick", { x: 2, y: 2 });

        expect(onActivate).toHaveBeenCalledTimes(1);
        expect((onActivate.mock.calls[0][0] as HFlexElement).id).toBe("r2");
    });

    it("right click over a consuming child opens the context menu as usual", () => {
        const onButton = vi.fn();
        const onContextMenu = vi.fn();
        const { list } = createList(onButton);
        list.onContextMenu = onContextMenu;

        mouse(list, "click", { x: BUTTON_X, y: 1, button: "right" });

        expect(onButton).not.toHaveBeenCalled();
        expect(onContextMenu).toHaveBeenCalledTimes(1);
    });

    it("ctrl/shift-clicks over a consuming child keep multi-select semantics", () => {
        const onButton = vi.fn();
        const { list } = createList(onButton);

        mouse(list, "click", { x: 2, y: 1 }); // обычный клик по имени — точка отсчёта
        mouse(list, "click", { x: BUTTON_X, y: 3, shiftKey: true });
        expect(list.getSelectedElements().map((el) => el.id)).toEqual(["r1", "r2", "r3"]);

        mouse(list, "click", { x: BUTTON_X, y: 0, ctrlKey: true });
        expect(list.getSelectedElements().map((el) => el.id)).toEqual(["r0", "r1", "r2", "r3"]);

        expect(onButton).not.toHaveBeenCalled();
    });

    it("scroll between frames disables delegation until the next layout", () => {
        const onButton = vi.fn();
        const list = new ListViewElement();
        for (let i = 0; i < 8; i++) list.appendRow(makeButtonRow(`r${i}`, onButton));
        const app = TestApp.createWithContent(list, new Size(WIDTH, 3));
        list.focus();

        // Скролл без прогона кадра: индексы уже новые, а позиции детей — от
        // layout-окна scrollTop=0. Делегация выключена, клик — обычное выделение.
        list.scrollBy(0, 2);
        mouse(list, "click", { x: BUTTON_X, y: 1 });
        expect(onButton).not.toHaveBeenCalled();
        expect(list.getCursorElement()?.id).toBe("r3");

        // После кадра окно перележано — делегация снова работает.
        app.render();
        mouse(list, "click", { x: BUTTON_X, y: 1 });
        expect(onButton).toHaveBeenCalledTimes(1);
    });

    it("clicks mapping beyond the laid window fall back to selection", () => {
        const onButton = vi.fn();
        const list = new ListViewElement();
        for (let i = 0; i < 8; i++) list.appendRow(makeButtonRow(`r${i}`, onButton));
        TestApp.createWithContent(list, new Size(WIDTH, 3));
        list.focus();

        mouse(list, "click", { x: BUTTON_X, y: 5 }); // индекс 5 вне окна [0, 3)

        expect(onButton).not.toHaveBeenCalled();
        expect(list.getCursorElement()?.id).toBe("r5");
    });

    it("appending rows invalidates the laid window until the next frame", () => {
        const onButton = vi.fn();
        const { list } = createList(onButton);

        list.appendRow(makeButtonRow("extra", onButton));
        mouse(list, "click", { x: BUTTON_X, y: 1 });

        expect(onButton).not.toHaveBeenCalled();
        expect(list.getCursorElement()?.id).toBe("r1");
    });

    it("rows without children are unaffected by delegation", () => {
        const list = new ListViewElement();
        for (let i = 0; i < 3; i++) list.appendRow(makePlainRow(`p${i}`));
        TestApp.createWithContent(list, new Size(WIDTH, 10));
        list.focus();

        mouse(list, "click", { x: 5, y: 1 });

        expect(list.getCursorElement()?.id).toBe("p1");
    });

    it("chevron gutter clicks still toggle collapse for grouped rows", () => {
        const onButton = vi.fn();
        const list = new ListViewElement();
        list.appendRow(makeButtonRow("group", onButton));
        list.appendRow(makeButtonRow("leaf", onButton), { parentId: "group" });
        TestApp.createWithContent(list, new Size(WIDTH, 10));
        list.focus();

        mouse(list, "click", { x: 0, y: 0 });

        expect(list.isCollapsed("group")).toBe(true);
        expect(onButton).not.toHaveBeenCalled();
    });
});
