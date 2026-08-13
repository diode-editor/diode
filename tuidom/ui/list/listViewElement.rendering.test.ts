import { describe, expect, it } from "vitest";

import { TestApp } from "../../testing/TestApp.ts";
import { packRgb } from "../../common/colorUtils.ts";
import { Point, Size } from "../../common/geometryPromitives.ts";
import { TextLabelElement } from "../text/textLabelElement.ts";

import { ListViewElement } from "./listViewElement.ts";

const ICON_EXPANDED = "";
const ICON_COLLAPSED = "";
// Шеврон — токен list.deemphasizedForeground; TestApp кладёт палитру dark+ (#808080).
const CHEVRON_FG = 0x808080;
const ACTIVE_BG = packRgb(4, 57, 94);
const ACTIVE_FG = packRgb(255, 255, 255);

function makeRow(id: string, text = id): TextLabelElement {
    const row = new TextLabelElement(text);
    row.id = id;
    return row;
}

function makeApp(list: ListViewElement, size = new Size(20, 5)): TestApp {
    return TestApp.createWithContent(list, size);
}

describe("ListViewElement rendering", () => {
    it("renders a flat list without a chevron gutter", () => {
        const list = new ListViewElement();
        list.appendRow(makeRow("a", "Alpha"));
        list.appendRow(makeRow("b", "Beta"));
        const app = makeApp(list);

        expect(app.backend.getTextAt(new Point(0, 0), 5)).toBe("Alpha");
        expect(app.backend.getTextAt(new Point(0, 1), 4)).toBe("Beta");
    });

    it("renders chevrons and indents children when the list has collapsible rows", () => {
        const list = new ListViewElement();
        list.appendRow(makeRow("file", "main.ts"));
        list.appendRow(makeRow("m1", "12: match"), { parentId: "file" });
        const app = makeApp(list);

        expect(app.backend.getTextAt(new Point(0, 0), 1)).toBe(ICON_EXPANDED);
        expect(app.backend.getFgAt(new Point(0, 0))).toBe(CHEVRON_FG);
        expect(app.backend.getTextAt(new Point(2, 0), 7)).toBe("main.ts");
        // Ребёнок глубины 1: контент с колонки 1*indent + 2 = 4.
        expect(app.backend.getTextAt(new Point(4, 1), 9)).toBe("12: match");
    });

    it("switches the chevron glyph when the row is collapsed", () => {
        const list = new ListViewElement();
        list.appendRow(makeRow("file", "main.ts"));
        list.appendRow(makeRow("m1", "match"), { parentId: "file" });
        const app = makeApp(list);

        list.setCollapsed("file", true);
        app.render();

        expect(app.backend.getTextAt(new Point(0, 0), 1)).toBe(ICON_COLLAPSED);
        // Свернувшийся ребёнок не рисуется — вторая строка пустая.
        expect(app.backend.getTextAt(new Point(0, 1), 5)).toBe("     ");
    });

    it("fills rows below the content with blanks", () => {
        const list = new ListViewElement();
        list.appendRow(makeRow("a", "only"));
        const app = makeApp(list);

        expect(app.backend.getTextAt(new Point(0, 1), 4)).toBe("    ");
        expect(app.backend.getTextAt(new Point(0, 4), 4)).toBe("    ");
    });

    it("renders the window at the scroll position", () => {
        const list = new ListViewElement();
        for (let i = 0; i < 20; i++) list.appendRow(makeRow(`r${i}`, `row ${i}`));
        const app = makeApp(list);

        list.scrollBy(0, 10);
        app.render();

        expect(app.backend.getTextAt(new Point(0, 0), 6)).toBe("row 10");
        expect(app.backend.getTextAt(new Point(0, 4), 6)).toBe("row 14");
    });

    it("selection overlay recolors inherited cells but keeps custom row colors", () => {
        const CUSTOM_FG = packRgb(200, 100, 50);
        const list = new ListViewElement();
        const row = makeRow("a", "Alpha");
        row.setCharStyle(0, { fg: CUSTOM_FG });
        list.appendRow(row);
        list.appendRow(makeRow("b", "Beta"));
        const app = makeApp(list);
        list.focus();
        app.render();

        // Курсор на строке 0: обычные ячейки перекрашены в selection...
        expect(app.backend.getBgAt(new Point(0, 0))).toBe(ACTIVE_BG);
        expect(app.backend.getFgAt(new Point(1, 0))).toBe(ACTIVE_FG);
        // ...а посимвольная подсветка строки выделение переживает.
        expect(app.backend.getFgAt(new Point(0, 0))).toBe(CUSTOM_FG);
        // Фон под выделенной строкой закрашен на всю ширину, включая хвост.
        expect(app.backend.getBgAt(new Point(19, 0))).toBe(ACTIVE_BG);
    });

    it("selection overlay patches wide chars without breaking them", () => {
        const list = new ListViewElement();
        list.appendRow(makeRow("cjk", "漢字"));
        const app = makeApp(list);
        list.focus();
        app.render();

        expect(app.backend.getTextAt(new Point(0, 0), 4)).toContain("漢");
        expect(app.backend.getBgAt(new Point(0, 0))).toBe(ACTIVE_BG);
        expect(app.backend.getBgAt(new Point(2, 0))).toBe(ACTIVE_BG);
    });

    it("hit-test always resolves to the list itself, not to culled rows", () => {
        const list = new ListViewElement();
        for (let i = 0; i < 100; i++) list.appendRow(makeRow(`r${i}`));
        TestApp.createWithContent(list, new Size(20, 5));

        // Закуленная строка r50 имеет globalPosition (0,0) и ленивый layoutSize —
        // базовый хит-тест отдал бы её в углу экрана. Наш override отдаёт список.
        expect(list.elementFromPoint(new Point(0, 0))).toBe(list);
        expect(list.elementFromPoint(new Point(19, 4))).toBe(list);
        expect(list.elementFromPoint(new Point(25, 0))).toBeNull();
    });

    it("keeps rows out of the Tab focus order", () => {
        const list = new ListViewElement();
        list.appendRow(makeRow("a"));
        expect(list.getDepthFirstFocusableOrder()).toEqual([list]);
        list.focusable = false;
        expect(list.getDepthFirstFocusableOrder()).toEqual([]);
    });
});
