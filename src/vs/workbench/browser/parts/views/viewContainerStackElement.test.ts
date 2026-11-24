import { BoxConstraints, Point, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { describe, expect, it } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { FrameElement } from "../frameElement.ts";

import { PaneViewElement } from "./paneViewElement.ts";
import { ViewContainerStackElement } from "./viewContainerStackElement.ts";

function sections(ids: readonly string[]): PaneViewElement {
    const view = new PaneViewElement();
    for (const id of ids) view.addPane({ id, title: id.toUpperCase(), body: new FillerElement() });
    return view;
}

function layout(element: TUIElement, width: number, height: number): void {
    element.layout(BoxConstraints.tight(new Size(width, height)));
}

function textRows(backend: ReturnType<typeof renderElement>, width: number, height: number): string[] {
    return Array.from({ length: height }, (_, y) => backend.getTextAt(new Point(0, y), width));
}

describe("ViewContainerStackElement", () => {
    it("the header, a line under it, then the sections in the rest", () => {
        const stack = new ViewContainerStackElement();
        const header = new TUIElement();
        const panes = sections(["a"]);
        stack.setParts(header, panes);
        layout(stack, 10, 12);

        expect(stack.getChildren()).toHaveLength(3);
        expect(header.localPosition.dy).toBe(0);
        expect(header.layoutSize).toEqual(new Size(10, 1));
        expect(panes.localPosition.dy).toBe(2);
        expect(panes.layoutSize).toEqual(new Size(10, 10));
    });

    it("draws its line as ─ across the width", () => {
        const stack = new ViewContainerStackElement();
        stack.setParts(new TUIElement(), new TUIElement());

        const backend = renderElement(stack, 8, 4, { themeVars: true });

        expect(textRows(backend, 8, 4)).toEqual(["        ", "─".repeat(8), "        ", "        "]);
    });

    it("merged (no header): the sections alone, from the top, with no line", () => {
        const stack = new ViewContainerStackElement();
        const panes = sections(["a"]);
        stack.setParts(null, panes);
        layout(stack, 10, 12);

        expect(stack.getChildren()).toEqual([panes]);
        expect(panes.localPosition.dy).toBe(0);
        expect(panes.layoutSize).toEqual(new Size(10, 12));
        expect(stack.getFrameJointRows()).toEqual(panes.getFrameJointRows());
        expect(stack.getFrameJointRows()).toEqual([1]);
    });

    it("joint rows: its line, then the sections' lines moved down by where the sections start", () => {
        const stack = new ViewContainerStackElement();
        const panes = sections(["a", "b"]);
        stack.setParts(new TUIElement(), panes);
        layout(stack, 10, 15); // the sections get 13 rows: 2 headers, 3 lines, bodies 4 and 4

        expect(panes.getFrameJointRows()).toEqual([1, 6, 8]);
        expect(stack.getFrameJointRows()).toEqual([1, 3, 8, 10]);
    });

    it("joint rows of sections that have no lines of their own: just its line", () => {
        const stack = new ViewContainerStackElement();
        stack.setParts(new TUIElement(), new TUIElement());
        layout(stack, 10, 6);

        expect(stack.getFrameJointRows()).toEqual([1]);
    });

    it("going from merged to a header puts the line back and moves the sections down", () => {
        const stack = new ViewContainerStackElement();
        const panes = sections(["a"]);
        stack.setParts(null, panes);
        layout(stack, 10, 8);
        expect(stack.getFrameJointRows()).toEqual([1]);

        stack.setParts(new TUIElement(), panes);
        layout(stack, 10, 8);

        expect(panes.localPosition.dy).toBe(2);
        expect(stack.getFrameJointRows()).toEqual([1, 3]);
    });

    it("in the sidebar's frame: ├ ┤ joints where every line meets the frame", () => {
        const stack = new ViewContainerStackElement();
        stack.setParts(new TUIElement(), sections(["a", "b"]));
        const frame = new FrameElement(stack);

        // The stack gets 10 × 17 inside: header, line, then the sections' 15 rows (bodies 5 and 5).
        const backend = renderElement(frame, 12, 19, { themeVars: true });
        const rows = textRows(backend, 12, 19);

        // Stack rows 1 (its line), 3, 9 and 11 (the sections' lines at 1, 7 and 9), one down for the frame's top.
        const joints = [2, 4, 10, 12];
        expect(frame.getJointRows()).toEqual(joints);
        expect(rows[0]).toBe(`╭${"─".repeat(10)}╮`);
        for (const y of joints) expect(rows[y]).toBe(`├${"─".repeat(10)}┤`);
        for (let y = 1; y < 18; y++) {
            if (joints.includes(y)) continue;
            expect(rows[y].at(0)).toBe("│");
            expect(rows[y].at(-1)).toBe("│");
        }
        expect(rows[18]).toBe(`╰${"─".repeat(10)}╯`);
        expect(rows[3]).toContain("A");
        expect(rows[11]).toContain("B");
    });
});
