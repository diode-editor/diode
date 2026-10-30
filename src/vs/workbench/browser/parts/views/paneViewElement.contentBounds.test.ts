import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";

import type { IPaneContentBounds } from "./paneViewElement.ts";
import { PaneViewElement } from "./paneViewElement.ts";

/** "editors" is sized by its content above "files" and "outline", as Open Editors in the Explorer. */
function makeView(bounds: IPaneContentBounds, ids: readonly string[] = ["editors", "files"]): PaneViewElement {
    const view = new PaneViewElement();
    for (const id of ids) {
        view.addPane({
            id,
            title: id.toUpperCase(),
            body: new FillerElement(),
            contentBounds: id === "editors" ? bounds : undefined,
        });
    }
    return view;
}

/** Sections top to bottom: a content-sized one has `bounds`, a regular one its `min` body height. */
function makePanes(
    panes: readonly { id: string; bounds?: IPaneContentBounds; min?: number }[],
    height: number,
): { view: PaneViewElement; app: TestApp } {
    const view = new PaneViewElement();
    for (const { id, bounds, min } of panes) {
        view.addPane({
            id,
            title: id.toUpperCase(),
            body: new FillerElement(),
            contentBounds: bounds,
            minBodyHeight: min,
        });
    }
    const app = TestApp.createWithContent(view, new Size(30, height));
    app.render();
    return { view, app };
}

function heights(view: PaneViewElement, height = 22): Record<string, number> {
    view.layout(BoxConstraints.tight(new Size(30, height)));
    const state = view.inspectState() as { panes: { id: string; bodyHeight: number }[] };
    return Object.fromEntries(state.panes.map((p) => [p.id, p.bodyHeight]));
}

function token(action: MouseToken["action"], x: number, y: number): MouseToken {
    return {
        kind: "mouse",
        button: "left",
        x: x + 1,
        y: y + 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
        action,
    };
}

function dragHeader(app: TestApp, id: string, delta: number): void {
    const header = app.querySelector(`#paneHeader-${id}`)!;
    const { x, y } = header.globalPosition;
    app.backend.simulateMouse(token("press", x + 2, y));
    app.backend.simulateMouse(token("move", x + 2, y + delta));
    app.backend.simulateMouse(token("release", x + 2, y + delta));
    app.render();
}

describe("PaneViewElement — content-sized section", () => {
    it("takes its minimum, the neighbors share the rest by weight", () => {
        const view = makeView({ min: 3, max: 12 }, ["editors", "files", "outline"]);
        // 22 rows − 3 headers = 19: editors 3, the other two 8 each.
        expect(heights(view)).toEqual({ editors: 3, files: 8, outline: 8 });
    });

    it("new bounds apply at the next layout: more tabs, a taller section", () => {
        const view = makeView({ min: 2, max: 2 });
        expect(heights(view)).toEqual({ editors: 2, files: 18 });

        view.setPaneContentBounds("editors", { min: 9, max: 30 });
        expect(heights(view)).toEqual({ editors: 9, files: 11 });

        view.setPaneContentBounds("editors", null);
        expect(heights(view)).toEqual({ editors: 10, files: 10 });
    });

    it("an empty section (0 rows) gives everything to the neighbors", () => {
        expect(heights(makeView({ min: 0, max: 0 }))).toEqual({ editors: 0, files: 20 });
    });

    it("alone among expanded sections it fills the container", () => {
        const view = makeView({ min: 2, max: 2 });
        view.setCollapsed("files", true);
        expect(heights(view)).toEqual({ editors: 20, files: 0 });
    });

    it("a cramped container cuts it to the available rows", () => {
        expect(heights(makeView({ min: 9, max: 30 }), 6)).toEqual({ editors: 4, files: 0 });
    });

    it("dragging grows it up to its maximum and keeps the dragged size; it never shrinks below the minimum", () => {
        const view = makeView({ min: 3, max: 8 });
        const app = TestApp.createWithContent(view, new Size(30, 22));
        app.render();

        dragHeader(app, "files", 2);
        expect(heights(view)).toEqual({ editors: 5, files: 15 });
        dragHeader(app, "files", 10);
        expect(heights(view)).toEqual({ editors: 8, files: 12 });
        dragHeader(app, "files", -10);
        expect(heights(view)).toEqual({ editors: 3, files: 17 });
    });

    it("a dragged neighbor is limited by the section's maximum from below", () => {
        const view = makeView({ min: 1, max: 4 }, ["files", "editors"]);
        const app = TestApp.createWithContent(view, new Size(30, 22));
        app.render();
        expect(heights(view)).toEqual({ files: 19, editors: 1 });

        dragHeader(app, "editors", -10);
        expect(heights(view)).toEqual({ files: 16, editors: 4 });
    });

    it("new bounds mark the layout dirty: the next frame resizes the sections", () => {
        const { view, app } = makePanes([{ id: "editors", bounds: { min: 2, max: 2 } }, { id: "files" }], 22);
        expect(view.isLayoutDirty).toBe(false);

        view.setPaneContentBounds("editors", { min: 6, max: 6 });
        expect(view.isLayoutDirty).toBe(true);
        app.render();

        expect(app.querySelector("#paneHeader-files")!.globalPosition.y).toBe(7);
    });

    it("a drag in a container too small for both minimums moves nothing", () => {
        // 6 rows − 2 headers: editors gets 4 of its 9, files none of its 1.
        const above = makePanes(
            [
                { id: "editors", bounds: { min: 9, max: 30 } },
                { id: "files", min: 1 },
            ],
            6,
        );
        dragHeader(above.app, "files", -2);
        expect(above.view.getWeights()).toEqual({ editors: 1, files: 1 });

        // The same with the content-sized section below: its minimum alone exceeds the container.
        const below = makePanes(
            [
                { id: "files", min: 1 },
                { id: "editors", bounds: { min: 9, max: 30 } },
            ],
            6,
        );
        dragHeader(below.app, "editors", 1);
        expect(below.view.getWeights()).toEqual({ files: 1, editors: 1 });
    });

    it("two sections exactly at the sum of their minimums: a drag gives the clipped one its minimum back", () => {
        // 7 rows − 2 headers = 5: editors keeps its dragged 5, files gets 0 of its 2.
        const { view, app } = makePanes(
            [
                { id: "files", min: 2 },
                { id: "editors", bounds: { min: 3, max: 10 } },
            ],
            7,
        );
        view.setWeights({ editors: 5 });
        app.render();

        dragHeader(app, "editors", 1);
        expect(view.getWeights()).toEqual({ files: 2, editors: 3 });
    });

    it("dragging the section's header down stops at its minimum", () => {
        const { view, app } = makePanes(
            [
                { id: "files", min: 1 },
                { id: "editors", bounds: { min: 3, max: 30 } },
            ],
            22,
        );
        expect(heights(view)).toEqual({ files: 17, editors: 3 });

        dragHeader(app, "editors", 3);
        expect(view.getWeights()).toEqual({ files: 1, editors: 1 });
        expect(heights(view)).toEqual({ files: 17, editors: 3 });
    });
});
