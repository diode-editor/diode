import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";

import { PaneViewElement } from "./paneViewElement.ts";

function makeHarness(): {
    app: TestApp;
    view: PaneViewElement;
    menuRequests: [string, { screenX: number; screenY: number }][];
    stateChanges: () => number;
    headerPos: (id: string) => { x: number; y: number };
} {
    const view = new PaneViewElement();
    for (const id of ["a", "b"]) {
        const body = new FillerElement();
        body.id = `${id}-body`;
        view.addPane({ id, title: id.toUpperCase(), body });
    }
    const menuRequests: [string, { screenX: number; screenY: number }][] = [];
    view.onDidRequestPaneMenu = (paneId, anchor) => menuRequests.push([paneId, anchor]);
    let changes = 0;
    view.onDidChangeState = () => changes++;

    const app = TestApp.createWithContent(view, new Size(30, 22));
    const headerPos = (id: string): { x: number; y: number } => {
        const header = app.querySelector(`#paneHeader-${id}`)!;
        return { x: header.globalPosition.x, y: header.globalPosition.y };
    };
    return { app, view, menuRequests, stateChanges: () => changes, headerPos };
}

function token(overrides: Partial<MouseToken> & { action: MouseToken["action"] }): MouseToken {
    return {
        kind: "mouse",
        button: "left",
        x: 1,
        y: 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
        ...overrides,
    };
}

/** Press + release in the same cell; 0-based screen coordinates. */
function click(app: TestApp, x: number, y: number, button: "left" | "right" = "left"): void {
    app.backend.simulateMouse(token({ action: "press", button, x: x + 1, y: y + 1 }));
    app.backend.simulateMouse(token({ action: "release", button, x: x + 1, y: y + 1 }));
}

function drag(app: TestApp, x: number, fromY: number, toY: number): void {
    app.backend.simulateMouse(token({ action: "press", x: x + 1, y: fromY + 1 }));
    app.backend.simulateMouse(token({ action: "move", x: x + 1, y: toY + 1 }));
    app.backend.simulateMouse(token({ action: "release", x: x + 1, y: toY + 1 }));
}

function bodyHeights(view: PaneViewElement): Record<string, number> {
    const state = view.inspectState() as { panes: { id: string; bodyHeight: number }[] };
    return Object.fromEntries(state.panes.map((p) => [p.id, p.bodyHeight]));
}

describe("PaneViewElement mouse", () => {
    it("a header click collapses and expands the section", () => {
        const { app, view, stateChanges, headerPos } = makeHarness();
        const pos = headerPos("b");
        click(app, pos.x + 2, pos.y);
        expect(view.isCollapsed("b")).toBe(true);
        expect(stateChanges()).toBe(1);
        click(app, pos.x + 2, headerPos("b").y);
        expect(view.isCollapsed("b")).toBe(false);
        expect(stateChanges()).toBe(2);
    });

    it("a click on the ⋯ button opens the menu and does not collapse the section", () => {
        const { app, view, menuRequests, headerPos } = makeHarness();
        const pos = headerPos("a");
        const menuX = pos.x + 28; // "⋯" is the rightmost 3 columns of the 30-wide header
        click(app, menuX, pos.y);
        expect(menuRequests).toEqual([["a", { screenX: menuX, screenY: pos.y }]]);
        expect(view.isCollapsed("a")).toBe(false);
    });

    it("a right click on the header opens the menu anchored at the click point", () => {
        const { app, menuRequests, headerPos } = makeHarness();
        const pos = headerPos("b");
        click(app, pos.x + 4, pos.y, "right");
        expect(menuRequests).toEqual([["b", { screenX: pos.x + 4, screenY: pos.y }]]);
    });

    it("dragging a header moves rows between sections and does not collapse", () => {
        const { app, view, stateChanges, headerPos } = makeHarness();
        const before = bodyHeights(view); // 10/10 at height 22
        const pos = headerPos("b");
        drag(app, pos.x + 2, pos.y, pos.y - 3);
        app.render();
        expect(bodyHeights(view)).toEqual({ a: before.a - 3, b: before.b + 3 });
        expect(view.isCollapsed("b")).toBe(false);
        expect(stateChanges()).toBe(1);
    });

    it("drag is clamped by the neighbor section's min height", () => {
        const { app, view, headerPos } = makeHarness();
        const pos = headerPos("b");
        drag(app, pos.x + 2, pos.y, pos.y - 15); // past section a's minimum
        app.render();
        expect(bodyHeights(view)).toEqual({ a: 3, b: 17 });
    });

    it("dragging the top header (nothing expanded above) changes nothing and does not collapse", () => {
        const { app, view, stateChanges, headerPos } = makeHarness();
        const before = bodyHeights(view);
        const pos = headerPos("a");
        drag(app, pos.x + 2, pos.y, pos.y + 4);
        app.render();
        expect(bodyHeights(view)).toEqual(before);
        expect(view.isCollapsed("a")).toBe(false);
        expect(stateChanges()).toBe(0);
    });

    it("after a drag weights freeze: a repeated layout reproduces the heights", () => {
        const { app, view, headerPos } = makeHarness();
        const pos = headerPos("b");
        drag(app, pos.x + 2, pos.y, pos.y - 2);
        app.render();
        const after = bodyHeights(view);
        app.render();
        expect(bodyHeights(view)).toEqual(after);
        expect(view.getWeights()).toEqual({ a: after.a, b: after.b });
    });

    it("mousemove without a held button is not a drag", () => {
        const { app, view, headerPos } = makeHarness();
        const before = bodyHeights(view);
        const pos = headerPos("b");
        app.backend.simulateMouse(token({ action: "move", x: pos.x + 3, y: pos.y + 1 }));
        app.render();
        expect(bodyHeights(view)).toEqual(before);
    });

    it("delegation: preventDefault on mouseup (ancestor capture phase) cancels the toggle", () => {
        const { app, view, headerPos } = makeHarness();
        view.addEventListener(
            "mouseup",
            (e) => {
                e.preventDefault();
            },
            { capture: true },
        );
        const pos = headerPos("a");
        click(app, pos.x + 2, pos.y);
        expect(view.isCollapsed("a")).toBe(false);
    });

    it("a drag held across a neighbor collapse is ignored afterwards (guards a capture race)", () => {
        const { app, view, stateChanges } = makeHarness();
        // Simulate: capture still holds header b, but nothing below it is expanded anymore.
        view.setCollapsed("b", true);
        app.render();
        const headerB = app.querySelector("#paneHeader-b")!;
        const before = bodyHeights(view);
        (headerB as { onDrag?: (y: number) => void }).onDrag?.(headerB.globalPosition.y - 2);
        app.render();
        expect(bodyHeights(view)).toEqual(before);
        expect(stateChanges()).toBe(0);
    });

    it("dragging onto its own border row is a no-op", () => {
        const { app, view, stateChanges } = makeHarness();
        const headerB = app.querySelector("#paneHeader-b")!;
        (headerB as { onDrag?: (y: number) => void }).onDrag?.(headerB.globalPosition.y);
        app.render();
        expect(stateChanges()).toBe(0);
        expect(view.getWeights()).toEqual({ a: 1, b: 1 });
    });

    it("dragging past the min after clamping is a no-op without an event", () => {
        const { app, view, stateChanges, headerPos } = makeHarness();
        const pos = headerPos("b");
        drag(app, pos.x + 2, pos.y, pos.y - 15); // clamped: a=3
        app.render();
        expect(stateChanges()).toBe(1);
        const headerB = app.querySelector("#paneHeader-b")!;
        (headerB as { onDrag?: (y: number) => void }).onDrag?.(headerB.globalPosition.y - 5);
        app.render();
        expect(bodyHeights(view)).toEqual({ a: 3, b: 17 });
        expect(stateChanges()).toBe(1);
    });

    it("two cramped sections (sum below the mins): the border does not move", () => {
        const view = new PaneViewElement();
        for (const id of ["a", "b"]) {
            const body = new FillerElement();
            body.id = `${id}-body`;
            view.addPane({ id, title: id.toUpperCase(), body });
        }
        let changes = 0;
        view.onDidChangeState = () => changes++;
        const app = TestApp.createWithContent(view, new Size(30, 7)); // bodies 3 and 2 < 3+3
        const headerB = app.querySelector("#paneHeader-b")!;
        (headerB as { onDrag?: (y: number) => void }).onDrag?.(headerB.globalPosition.y - 1);
        app.render();
        expect(bodyHeights(view)).toEqual({ a: 3, b: 2 });
        expect(changes).toBe(0);
    });

    it("a collapsed section does not take part in weight freezing on drag", () => {
        const view = new PaneViewElement();
        for (const id of ["a", "b", "c"]) {
            const body = new FillerElement();
            body.id = `${id}-body`;
            view.addPane({ id, title: id.toUpperCase(), body });
        }
        view.setCollapsed("c", true);
        const app = TestApp.createWithContent(view, new Size(30, 22));
        const headerB = app.querySelector("#paneHeader-b")!;
        (headerB as { onDrag?: (y: number) => void }).onDrag?.(headerB.globalPosition.y - 2);
        app.render();
        const weights = view.getWeights();
        expect(weights.c).toBe(1); // the collapsed section's weight is untouched
        expect(weights.a + weights.b).toBe(19); // actual heights of the expanded sections (22 − 3 headers)
    });

    it("a click on an inline header button is reported up with the section id", () => {
        const { app, view, headerPos } = makeHarness();
        const actions: [string, string][] = [];
        view.onDidRequestPaneAction = (paneId, actionId) => actions.push([paneId, actionId]);
        view.setPaneActions("a", [{ id: "cmd.refresh", icon: "R" }]);
        app.render();

        // The button is the 3 columns left of "⋯" at the right edge (width 30).
        const pos = headerPos("a");
        const x = pos.x + 30 - 3 - 2;
        app.backend.simulateMouse(token({ action: "press", x: x + 1, y: pos.y + 1 }));
        app.backend.simulateMouse(token({ action: "release", x: x + 1, y: pos.y + 1 }));
        expect(actions).toEqual([["a", "cmd.refresh"]]);
    });

    it("hover highlights the button under the pointer, leaving clears it", () => {
        const { app, view, headerPos } = makeHarness();
        view.setPaneActions("a", [{ id: "cmd.refresh", icon: "R" }]);
        app.render();
        const pos = headerPos("a");
        // The button is the 3 columns at the right edge (width 30), with no "⋯" to its left:
        // the fixture section's menu is empty.
        const buttonX = pos.x + 30 - 2;
        const restBg = app.backend.getBgAt(new Point(buttonX, pos.y));

        app.backend.simulateMouse(token({ action: "move", x: buttonX + 1, y: pos.y + 1 }));
        app.render();
        const hoverBg = app.backend.getBgAt(new Point(buttonX, pos.y));
        expect(hoverBg).not.toBe(restBg);

        app.backend.simulateMouse(token({ action: "move", x: pos.x + 3, y: pos.y + 1 }));
        app.render();
        expect(app.backend.getBgAt(new Point(buttonX, pos.y))).toBe(restBg);

        // ...and the same when the cursor leaves the header entirely (mouseleave).
        app.backend.simulateMouse(token({ action: "move", x: buttonX + 1, y: pos.y + 1 }));
        app.render();
        expect(app.backend.getBgAt(new Point(buttonX, pos.y))).not.toBe(restBg);
        app.backend.simulateMouse(token({ action: "move", x: buttonX + 1, y: pos.y + 3 }));
        app.render();
        expect(app.backend.getBgAt(new Point(buttonX, pos.y))).toBe(restBg);
    });

    it("header children are presentational: hit testing returns the header", () => {
        const { app, headerPos } = makeHarness();
        const pos = headerPos("a");
        const spy = vi.fn();
        const header = app.querySelector("#paneHeader-a")!;
        header.addEventListener("mousedown", spy);
        app.backend.simulateMouse(token({ action: "press", x: pos.x + 2, y: pos.y + 1 }));
        app.backend.simulateMouse(token({ action: "release", x: pos.x + 2, y: pos.y + 1 }));
        expect(spy).toHaveBeenCalledOnce();
    });
});
