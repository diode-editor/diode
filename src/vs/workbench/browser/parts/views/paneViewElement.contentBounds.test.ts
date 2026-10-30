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
});
