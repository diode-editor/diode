import { describe, expect, it, vi } from "vitest";

import { TextLabelElement } from "../text/textLabelElement.ts";

import { ListViewElement } from "./listViewElement.ts";

function makeRow(id: string): TextLabelElement {
    const row = new TextLabelElement(id);
    row.id = id;
    return row;
}

/** file1 → [m1, m2], file2 → [m3] */
function makeGroupedList(): ListViewElement {
    const list = new ListViewElement();
    list.appendRow(makeRow("file1"));
    list.appendRow(makeRow("m1"), { parentId: "file1" });
    list.appendRow(makeRow("m2"), { parentId: "file1" });
    list.appendRow(makeRow("file2"));
    list.appendRow(makeRow("m3"), { parentId: "file2" });
    return list;
}

describe("ListViewElement collapse", () => {
    it("collapsing hides the subtree from the visible projection", () => {
        const list = makeGroupedList();
        expect(list.contentHeight).toBe(5);

        list.setCollapsed("file1", true);
        expect(list.contentHeight).toBe(3);
        expect(list.isCollapsed("file1")).toBe(true);
        // Дети остаются детьми контейнера (стили/root), просто невидимы.
        expect(list.getChildren()).toHaveLength(5);

        list.setCollapsed("file1", false);
        expect(list.contentHeight).toBe(5);
        expect(list.isCollapsed("file1")).toBe(false);
    });

    it("collapse hides nested descendants too", () => {
        const list = new ListViewElement();
        list.appendRow(makeRow("a"));
        list.appendRow(makeRow("b"), { parentId: "a" });
        list.appendRow(makeRow("c"), { parentId: "b" });
        list.setCollapsed("a", true);
        expect(list.contentHeight).toBe(1);
    });

    it("a collapsed inner node stays collapsed while the ancestor toggles", () => {
        const list = new ListViewElement();
        list.appendRow(makeRow("a"));
        list.appendRow(makeRow("b"), { parentId: "a" });
        list.appendRow(makeRow("c"), { parentId: "b" });
        list.setCollapsed("b", true);
        list.setCollapsed("a", true);
        list.setCollapsed("a", false);
        expect(list.contentHeight).toBe(2); // c остаётся спрятан под b
    });

    it("toggleCollapsed flips the state and fires onCollapsedChanged", () => {
        const list = makeGroupedList();
        const onCollapsedChanged = vi.fn();
        list.onCollapsedChanged = onCollapsedChanged;

        list.toggleCollapsed("file1");
        expect(onCollapsedChanged).toHaveBeenCalledWith(list.getChildren()[0], true);
        list.toggleCollapsed("file1");
        expect(onCollapsedChanged).toHaveBeenCalledWith(list.getChildren()[0], false);
    });

    it("collapse is a no-op for childless rows and repeated states", () => {
        const list = makeGroupedList();
        const onCollapsedChanged = vi.fn();
        list.onCollapsedChanged = onCollapsedChanged;

        list.setCollapsed("m1", true); // лист — нечего сворачивать
        expect(list.isCollapsed("m1")).toBe(false);
        list.setCollapsed("file1", false); // уже раскрыт
        expect(onCollapsedChanged).not.toHaveBeenCalled();
    });

    it("throws for an unknown id", () => {
        const list = makeGroupedList();
        expect(() => list.setCollapsed("ghost", true)).toThrow(/unknown row id "ghost"/);
        expect(() => list.setRowHidden("ghost", true)).toThrow(/unknown row id "ghost"/);
    });

    it("setRowHidden hides a row with its subtree and is reversible", () => {
        const list = makeGroupedList();
        list.setRowHidden("file1", true);
        expect(list.contentHeight).toBe(2); // file2 + m3
        list.setRowHidden("file1", true); // повтор — no-op
        expect(list.contentHeight).toBe(2);
        list.setRowHidden("file1", false);
        expect(list.contentHeight).toBe(5);
    });

    it("setCursorTo expands collapsed ancestors to reveal the target", () => {
        const list = new ListViewElement();
        list.appendRow(makeRow("a"));
        list.appendRow(makeRow("b"), { parentId: "a" });
        list.appendRow(makeRow("c"), { parentId: "b" });
        list.setCollapsed("b", true);
        list.setCollapsed("a", true);

        list.setCursorTo("c");
        expect(list.isCollapsed("a")).toBe(false);
        expect(list.isCollapsed("b")).toBe(false);
        expect(list.inspectState()).toMatchObject({ cursorId: "c" });
    });
});
