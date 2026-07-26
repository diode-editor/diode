import { describe, expect, it } from "vitest";

import { TestApp } from "../../../src/TestUtils/TestApp.ts";
import { Size } from "../../common/geometryPromitives.ts";
import type { BoxConstraints } from "../../common/geometryPromitives.ts";
import { TUIElement } from "../../dom/tuiElement.ts";

import { ListViewElement } from "./listViewElement.ts";

/** Строка-зонд: считает вызовы performLayout, чтобы видеть окно виртуализации. */
class ProbeRow extends TUIElement {
    public layoutCalls = 0;

    public constructor(id: string) {
        super();
        this.id = id;
    }

    public override performLayout(constraints: BoxConstraints): Size {
        this.layoutCalls++;
        return super.performLayout(constraints);
    }
}

function makeList(rowCount: number): { list: ListViewElement; rows: ProbeRow[] } {
    const list = new ListViewElement();
    const rows: ProbeRow[] = [];
    for (let i = 0; i < rowCount; i++) {
        const row = new ProbeRow(`r${i}`);
        rows.push(row);
        list.appendRow(row);
    }
    return { list, rows };
}

describe("ListViewElement virtualization", () => {
    it("lays out only the rows inside the viewport window", () => {
        const { list, rows } = makeList(100);
        TestApp.createWithContent(list, new Size(20, 5));

        expect(rows[0].layoutCalls).toBeGreaterThan(0);
        expect(rows[4].layoutCalls).toBeGreaterThan(0);
        expect(rows[5].layoutCalls).toBe(0);
        expect(rows[99].layoutCalls).toBe(0);
    });

    it("positions visible rows at consecutive viewport lines", () => {
        const { list, rows } = makeList(10);
        TestApp.createWithContent(list, new Size(20, 5));

        expect(rows[0].globalPosition.y).toBe(0);
        expect(rows[3].globalPosition.y).toBe(3);
        expect(rows[0].layoutSize.height).toBe(1);
        expect(rows[0].layoutSize.width).toBe(20);
    });

    it("scrolling shifts the layout window", () => {
        const { list, rows } = makeList(100);
        const app = TestApp.createWithContent(list, new Size(20, 5));

        list.scrollBy(0, 50);
        app.render();

        expect(rows[50].layoutCalls).toBeGreaterThan(0);
        expect(rows[54].layoutCalls).toBeGreaterThan(0);
        expect(rows[50].globalPosition.y).toBe(0);
    });

    it("append does not reset scroll, cursor or collapse state", () => {
        const list = new ListViewElement();
        for (let i = 0; i < 30; i++) {
            const row = new ProbeRow(`r${i}`);
            list.appendRow(row);
        }
        list.appendRow(new ProbeRow("r5-kid"), { parentId: "r5" });
        const app = TestApp.createWithContent(list, new Size(20, 5));
        list.setCollapsed("r5", true);
        list.setCursorTo("r10");
        list.scrollBy(0, 8);
        app.render();
        const scrollBefore = list.scrollTop;

        for (let i = 0; i < 10; i++) {
            list.appendRow(new ProbeRow(`extra${i}`));
        }
        app.render();

        expect(list.scrollTop).toBe(scrollBefore);
        expect(list.isCollapsed("r5")).toBe(true);
        expect(list.inspectState()).toMatchObject({ cursorId: "r10" });
    });

    it("keeps the cursor on the nearest row when its row gets hidden", () => {
        const { list } = makeList(10);
        TestApp.createWithContent(list, new Size(20, 5));
        list.setCursorTo("r4");

        list.setRowHidden("r4", true);
        // r4 пропал — курсор остаётся на том же индексе, теперь это r5.
        expect(list.inspectState()).toMatchObject({ cursorId: "r5" });
    });

    it("lazily rebuilds the projection once for a burst of appends", () => {
        const { list } = makeList(3);
        // Проекция пересобирается лениво: пока её никто не читает, серия append'ов
        // не платит O(N) каждая. Наблюдаемое свойство — contentHeight актуален после
        // серии и до/после чтения не меняется.
        for (let i = 0; i < 50; i++) {
            const row = new ProbeRow(`burst${i}`);
            list.appendRow(row);
        }
        expect(list.contentHeight).toBe(53);
    });

    it("collapsed rows drop out of the layout window entirely", () => {
        const list = new ListViewElement();
        const parent = new ProbeRow("p");
        list.appendRow(parent);
        const kids: ProbeRow[] = [];
        for (let i = 0; i < 4; i++) {
            const kid = new ProbeRow(`k${i}`);
            kids.push(kid);
            list.appendRow(kid, { parentId: "p" });
        }
        const app = TestApp.createWithContent(list, new Size(20, 10));
        expect(kids[0].layoutCalls).toBeGreaterThan(0);
        const callsBefore = kids[0].layoutCalls;

        list.setCollapsed("p", true);
        app.render();
        expect(kids[0].layoutCalls).toBe(callsBefore);
    });
});
