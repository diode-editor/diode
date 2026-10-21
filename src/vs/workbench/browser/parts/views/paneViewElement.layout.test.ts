import { BoxConstraints, Point, Size } from "@tuidom/core/common/geometryPromitives";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { describe, expect, it } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";

import { PaneViewElement } from "./paneViewElement.ts";

interface IPaneSpec {
    readonly id: string;
    readonly minBodyHeight?: number;
}

function makeView(specs: readonly IPaneSpec[]): { view: PaneViewElement; bodies: Map<string, TUIElement> } {
    const view = new PaneViewElement();
    const bodies = new Map<string, TUIElement>();
    for (const spec of specs) {
        const body = new FillerElement();
        body.id = `${spec.id}-body`;
        bodies.set(spec.id, body);
        view.addPane({ id: spec.id, title: spec.id.toUpperCase(), body, minBodyHeight: spec.minBodyHeight });
    }
    return { view, bodies };
}

function layout(view: PaneViewElement, width: number, height: number): void {
    view.layout(BoxConstraints.tight(new Size(width, height)));
}

function bodyHeights(view: PaneViewElement): Record<string, number> {
    const state = view.inspectState() as { panes: { id: string; bodyHeight: number }[] };
    return Object.fromEntries(state.panes.map((p) => [p.id, p.bodyHeight]));
}

describe("PaneViewElement layout", () => {
    it("splits the remainder evenly between expanded sections with equal weights", () => {
        const { view } = makeView([{ id: "a" }, { id: "b" }]);
        layout(view, 30, 20); // 2 headers → 18 rows left
        expect(bodyHeights(view)).toEqual({ a: 9, b: 9 });
    });

    it("weights set the proportions", () => {
        const { view } = makeView([{ id: "a" }, { id: "b" }]);
        view.setWeights({ a: 2, b: 1 });
        layout(view, 30, 20);
        expect(bodyHeights(view)).toEqual({ a: 12, b: 6 });
    });

    it("largest remainder is deterministic: the remainder goes to earlier sections", () => {
        const { view } = makeView([{ id: "a" }, { id: "b" }, { id: "c" }]);
        layout(view, 30, 20); // 3 headers → 17 rows left = 6 + 6 + 5
        expect(bodyHeights(view)).toEqual({ a: 6, b: 6, c: 5 });
    });

    it("a collapsed section is only its header, the remainder goes to the expanded one", () => {
        const { view, bodies } = makeView([{ id: "a" }, { id: "b" }]);
        view.setCollapsed("b", true);
        layout(view, 30, 20);
        expect(bodyHeights(view)).toEqual({ a: 18, b: 0 });
        expect(bodies.get("b")!.hidden).toBe(true);
        expect(view.isCollapsed("b")).toBe(true);
    });

    it("all sections collapsed: headers stack at the top", () => {
        const { view } = makeView([{ id: "a" }, { id: "b" }]);
        view.setCollapsed("a", true);
        view.setCollapsed("b", true);
        layout(view, 30, 20);
        expect(bodyHeights(view)).toEqual({ a: 0, b: 0 });
        const headerB = view.querySelector("#paneHeader-b")!;
        expect(headerB.localPosition.dy).toBe(1);
    });

    it("min height raises a cramped section's share, the tail is clipped", () => {
        const { view } = makeView([{ id: "a" }, { id: "b" }, { id: "c" }]);
        layout(view, 30, 10); // 7 rows left, min 3: shares 3/2/2 → desired 3/3/3 → 3/3/1
        expect(bodyHeights(view)).toEqual({ a: 3, b: 3, c: 1 });
    });

    it("not enough height even for headers: trailing ones are clipped to zero", () => {
        const { view } = makeView([{ id: "a" }, { id: "b" }, { id: "c" }]);
        layout(view, 30, 2);
        expect(bodyHeights(view)).toEqual({ a: 0, b: 0, c: 0 });
        const headerC = view.querySelector("#paneHeader-c")!;
        expect(headerC.layoutSize.height).toBe(0);
    });

    it("repeated layout with unchanged state reproduces the same heights", () => {
        const { view } = makeView([{ id: "a" }, { id: "b" }, { id: "c" }]);
        view.setWeights({ a: 7, b: 5, c: 5 });
        layout(view, 30, 20);
        const first = bodyHeights(view);
        layout(view, 30, 20);
        expect(bodyHeights(view)).toEqual(first);
    });

    it("setWeights ignores unknown ids and garbage values", () => {
        const { view } = makeView([{ id: "a" }, { id: "b" }]);
        view.setWeights({ a: 2, ghost: 5, b: Number.NaN });
        layout(view, 30, 20);
        expect(view.getWeights()).toEqual({ a: 2, b: 1 });
        expect(bodyHeights(view)).toEqual({ a: 12, b: 6 });
    });

    it("the only expanded section gets the whole remainder regardless of weights", () => {
        const { view } = makeView([{ id: "a" }, { id: "b" }]);
        view.setWeights({ a: 1, b: 100 });
        view.setCollapsed("b", true);
        layout(view, 30, 20);
        expect(bodyHeights(view)).toEqual({ a: 18, b: 0 });
    });

    it("addPane with a duplicate id throws, removePane removes the section", () => {
        const { view } = makeView([{ id: "a" }, { id: "b" }]);
        expect(() => {
            view.addPane({ id: "a", title: "A", body: new FillerElement() });
        }).toThrow(/duplicate pane id/);
        view.removePane("ghost"); // unknown id is a silent no-op
        view.removePane("b");
        expect(view.getPaneIds()).toEqual(["a"]);
        layout(view, 30, 20);
        expect(bodyHeights(view)).toEqual({ a: 19 });
    });

    it("the header renders the chevron, title and ⋯ button", () => {
        const { view } = makeView([{ id: "changes" }]);
        const backend = renderElement(view, 30, 6, { themeVars: true });
        const headerRow = backend.getTextAt(new Point(0, 0), 30);
        expect(headerRow).toContain("CHANGES");
        expect(headerRow).toContain("⋯");
    });

    it("programmatic setCollapsed does not fire onDidChangeState, toggle does", () => {
        const { view } = makeView([{ id: "a" }, { id: "b" }]);
        let notified = 0;
        view.onDidChangeState = () => notified++;
        view.setCollapsed("a", true);
        expect(notified).toBe(0);
        view.toggleCollapsed("a");
        expect(notified).toBe(1);
        expect(view.isCollapsed("a")).toBe(false);
    });

    it("an unknown id throws", () => {
        const { view } = makeView([{ id: "a" }]);
        expect(() => view.isCollapsed("ghost")).toThrow(/unknown pane id/);
    });

    it("setPaneBody replaces the body, keeping collapsed state; the same body is a no-op", () => {
        const { view, bodies } = makeView([{ id: "a" }, { id: "b" }]);
        view.setCollapsed("a", true);

        const next = new FillerElement();
        next.id = "a-next";
        view.setPaneBody("a", next);
        expect(view.querySelector("#a-next")).toBe(next);
        expect(view.querySelector("#a-body")).toBeNull();
        // The collapsed section's hidden state carries over to the new body.
        expect(next.hidden).toBe(true);

        view.setPaneBody("a", next);
        expect(view.querySelector("#a-next")).toBe(next);
        expect(bodies.get("b")!.hidden).toBe(false);
    });

    it("a section without its own header row takes no row for it", () => {
        const view = new PaneViewElement();
        const body = new FillerElement();
        body.id = "solo-body";
        view.addPane({ id: "solo", title: "SOLO", body, headerVisible: false });
        layout(view, 20, 5);
        expect(body.layoutSize.height).toBe(5);
        expect(view.querySelector("#paneHeader-solo")!.hidden).toBe(true);
    });
});
