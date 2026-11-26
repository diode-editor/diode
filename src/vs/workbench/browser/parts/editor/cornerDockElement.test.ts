import { Point } from "@tuidom/core/common/geometryPromitives";
import { SizedBoxElement } from "@tuidom/elements/layout/sizedBoxElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { describe, expect, it } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";

import { CORNER_RIGHT_MARGIN, CornerDockElement } from "./cornerDockElement.ts";

function widget(text: string): SizedBoxElement {
    const box = new SizedBoxElement(text.length, 2);
    box.setChild(new TextLabelElement(text));
    return box;
}

describe("CornerDockElement", () => {
    it("keeps the widget at the right edge, the frame line and a column in, at any width", () => {
        const dock = new CornerDockElement();
        dock.setChild(widget("[tool]"));

        expect(CORNER_RIGHT_MARGIN).toBe(2);
        expect(renderElement(dock, 30, 3).screenToString().split("\n")[0]).toBe(`${" ".repeat(22)}[tool]  `);
        expect(renderElement(dock, 12, 3).screenToString().split("\n")[0]).toBe("    [tool]  ");
    });

    it("clips a widget wider than the room to it", () => {
        const dock = new CornerDockElement();
        dock.setChild(widget("[a long tool]"));

        expect(renderElement(dock, 8, 2).screenToString().split("\n")[0]).toBe("[a lon  ");
    });

    it("without a widget the row is empty and paints nothing", () => {
        const dock = new CornerDockElement();

        expect(renderElement(dock, 10, 2).screenToString()).toBe(`${" ".repeat(10)}\n${" ".repeat(10)}`);
    });

    it("a row lower than the widget clips it", () => {
        const dock = new CornerDockElement();
        dock.setChild(widget("[tool]"));

        expect(renderElement(dock, 10, 1).screenToString()).toBe("  [tool]  ");
    });

    it("a point beside the widget is not the dock's; the widget's is the widget's", () => {
        const dock = new CornerDockElement();
        const tool = widget("[tool]");
        dock.setChild(tool);
        renderElement(dock, 30, 3);

        expect(dock.elementFromPoint(new Point(2, 0))).toBeNull();
        expect(dock.elementFromPoint(new Point(25, 0))?.getAncestorPath()).toContain(tool);
        expect(dock.elementFromPoint(new Point(28, 0))).toBeNull();
    });

    it("reports a new width after the frame, once per width; replacing the widget keeps the width", async () => {
        const dock = new CornerDockElement();
        const widths: number[] = [];
        dock.onDidChangeWidth = (width) => widths.push(width);
        dock.setChild(widget("[tool]"));

        renderElement(dock, 30, 3);
        expect(widths).toEqual([]);
        await Promise.resolve();
        expect(widths).toEqual([30]);

        dock.setChild(widget("[other]"));
        renderElement(dock, 30, 3);
        renderElement(dock, 20, 3);
        await Promise.resolve();
        expect(widths).toEqual([30, 20]);
    });
});
