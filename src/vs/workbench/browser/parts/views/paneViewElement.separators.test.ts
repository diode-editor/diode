import { BoxConstraints, Point, Size } from "@tuidom/core/common/geometryPromitives";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { describe, expect, it } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { computeThemeVars } from "../../../../platform/theme/browser/themeStyleVars.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";

import { PaneViewElement } from "./paneViewElement.ts";

function makeView(ids: readonly string[], options: { headerVisible?: boolean } = {}): PaneViewElement {
    const view = new PaneViewElement();
    for (const id of ids) {
        view.addPane({ id, title: id.toUpperCase(), body: new FillerElement(), headerVisible: options.headerVisible });
    }
    return view;
}

function layout(view: PaneViewElement, width: number, height: number): void {
    view.layout(BoxConstraints.tight(new Size(width, height)));
}

function headerY(view: PaneViewElement, id: string): number {
    return view.querySelector(`#paneHeader-${id}`)!.localPosition.dy;
}

describe("PaneViewElement — separator lines", () => {
    it("a line above every header but the first and one under every expanded header", () => {
        const view = makeView(["a", "b", "c"]);
        layout(view, 20, 20); // 20 − 3 headers − 5 lines = 12 rows: 4 per body

        expect(headerY(view, "a")).toBe(0);
        expect(headerY(view, "b")).toBe(7);
        expect(headerY(view, "c")).toBe(14);
        // Under a; above b, under b; above c, under c.
        expect(view.getFrameJointRows()).toEqual([1, 6, 8, 13, 15]);
    });

    it("a collapsed section's header has no line under it: the next header's line closes it", () => {
        const view = makeView(["a", "b", "c"]);
        view.setCollapsed("b", true);
        layout(view, 20, 20); // 20 − 3 headers − 4 lines = 13 rows: a 7, c 6

        expect(headerY(view, "b")).toBe(10);
        expect(headerY(view, "c")).toBe(12);
        expect(view.getFrameJointRows()).toEqual([1, 9, 11, 13]);
    });

    it("all sections collapsed: only the lines between the headers", () => {
        const view = makeView(["a", "b"]);
        view.setCollapsed("a", true);
        view.setCollapsed("b", true);
        layout(view, 20, 20);

        expect(view.getFrameJointRows()).toEqual([1]);
        expect(headerY(view, "b")).toBe(2);
    });

    it("a section without a header (a panel tab) gets no lines: the body takes every row", () => {
        const view = makeView(["solo"], { headerVisible: false });
        layout(view, 20, 6);

        expect(view.getFrameJointRows()).toEqual([]);
        const state = view.inspectState() as { panes: { bodyHeight: number }[] };
        expect(state.panes[0].bodyHeight).toBe(6);
    });

    it("lines past the bottom are clipped like the headers", () => {
        const view = makeView(["a", "b"]);
        layout(view, 20, 2);
        // a's header and its line fill the rows; the line above b would be the third.
        expect(view.getFrameJointRows()).toEqual([1]);
        expect(view.querySelector("#paneHeader-b")!.layoutSize.height).toBe(0);

        layout(view, 20, 1);
        expect(view.getFrameJointRows()).toEqual([]);
    });

    it("the rows follow a collapse at the next layout", () => {
        const view = makeView(["a", "b"]);
        layout(view, 20, 21);
        expect(view.getFrameJointRows()).toEqual([1, 10, 12]);

        view.toggleCollapsed("a");
        layout(view, 20, 21);

        expect(view.getFrameJointRows()).toEqual([1, 3]);
    });

    it("renders the lines as ─ across the whole width, in panel.border", () => {
        const view = makeView(["a", "b"]);
        view.style = { bg: "sideBar.background" };
        const backend = renderElement(view, 12, 13, { themeVars: true }); // bodies 4 rows each
        const border = computeThemeVars(WorkbenchTheme.fromThemeFile(darkPlusTheme))["panel.border"];

        const rows = Array.from({ length: 13 }, (_, y) => backend.getTextAt(new Point(0, y), 12));
        const line = "─".repeat(12);
        expect(rows.flatMap((row, y) => (row === line ? [y] : []))).toEqual([1, 6, 8]);
        expect(view.getFrameJointRows()).toEqual([1, 6, 8]);
        for (const y of view.getFrameJointRows()) {
            expect(backend.getFgAt(new Point(0, y))).toBe(border);
            expect(backend.getFgAt(new Point(11, y))).toBe(border);
            expect(backend.getBgAt(new Point(5, y))).toBe(backend.getBgAt(new Point(5, 2)));
        }
    });
});
