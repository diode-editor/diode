import { describe, expect, it } from "vitest";

import { TextLabelElement } from "../text/textLabelElement.ts";

import { ListViewElement } from "./listViewElement.ts";

function makeRow(id: string, text = id): TextLabelElement {
    const row = new TextLabelElement(text);
    row.id = id;
    return row;
}

describe("ListViewElement rows", () => {
    it("appends top-level rows in order", () => {
        const list = new ListViewElement();
        list.appendRow(makeRow("a"));
        list.appendRow(makeRow("b"));
        expect(list.rowCount).toBe(2);
        expect(list.contentHeight).toBe(2);
        expect(list.getChildren().map((host) => host.getChildren()[0].id)).toEqual(["a", "b"]);
    });

    it("throws when a row has no id", () => {
        const list = new ListViewElement();
        expect(() => {
            list.appendRow(new TextLabelElement("x"));
        }).toThrow(/non-empty id/);
    });

    it("throws when a row has an empty id", () => {
        const list = new ListViewElement();
        const row = new TextLabelElement("x");
        row.id = "";
        expect(() => {
            list.appendRow(row);
        }).toThrow(/non-empty id/);
    });

    it("throws on a duplicate id", () => {
        const list = new ListViewElement();
        list.appendRow(makeRow("a"));
        expect(() => {
            list.appendRow(makeRow("a"));
        }).toThrow(/duplicate row id "a"/);
    });

    it("throws on an unknown parentId", () => {
        const list = new ListViewElement();
        expect(() => {
            list.appendRow(makeRow("child"), { parentId: "ghost" });
        }).toThrow(/unknown parentId "ghost"/);
    });

    it("derives depth from the parent chain; getChildren — в порядке вставки", () => {
        const list = new ListViewElement();
        list.appendRow(makeRow("file1"));
        list.appendRow(makeRow("m1"), { parentId: "file1" });
        list.appendRow(makeRow("m1.1"), { parentId: "m1" });
        list.appendRow(makeRow("file2"));
        list.appendRow(makeRow("m2"), { parentId: "file2" });
        // Дозапись в поддерево первого файла после начала второго.
        list.appendRow(makeRow("m1.2"), { parentId: "m1" });

        // getChildren — плоский список владения (порядок вставки, O(1) append);
        // DFS-порядок иерархии держит видимая проекция, а не список детей.
        expect(list.getChildren().map((host) => host.getChildren()[0].id)).toEqual([
            "file1",
            "m1",
            "m1.1",
            "file2",
            "m2",
            "m1.2",
        ]);
        expect(list.contentHeight).toBe(6);
    });

    it("sets itself as parent of appended rows and detaches them on clear", () => {
        const list = new ListViewElement();
        const row = makeRow("a");
        list.appendRow(row);
        // Строка живёт в обёртке-носителе состояний; список — дедушка.
        expect(row.getParent()?.getParent()).toBe(list);

        list.clear();
        expect(row.getParent()?.getParent() ?? null).toBeNull();
        expect(list.rowCount).toBe(0);
        expect(list.contentHeight).toBe(0);
        expect(list.getChildren()).toEqual([]);
    });

    it("clear resets scroll, cursor and collapse state", () => {
        const list = new ListViewElement();
        for (let i = 0; i < 50; i++) list.appendRow(makeRow(`r${i}`));
        list.appendRow(makeRow("kid"), { parentId: "r49" });
        list.setCollapsed("r49", true);
        list.setCursorTo("r10");
        list.scrollBy(0, 5);

        list.clear();
        expect(list.inspectState()).toMatchObject({
            cursorId: null,
            selectedIds: [],
            collapsedIds: [],
            visibleCount: 0,
            totalCount: 0,
            scrollTop: 0,
        });
    });

    it("reports state through inspectState", () => {
        const list = new ListViewElement();
        list.appendRow(makeRow("a"));
        list.appendRow(makeRow("a1"), { parentId: "a" });
        list.setCursorTo("a1");
        expect(list.inspectState()).toMatchObject({
            cursorId: "a1",
            visibleCount: 2,
            totalCount: 2,
        });
    });
});
