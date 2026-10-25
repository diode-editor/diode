import { BoxConstraints, Offset, Size } from "@tuidom/core/common/geometryPromitives";
import { MouseEventDispatcher } from "@tuidom/core/dom/events/mouseEventDispatcher";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { SashElement } from "@tuidom/elements/sash/sashElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";

import { WorkbenchLayoutElement } from "./workbenchLayoutElement.ts";

/** Mouse at a screen column/row (0-based; the mouse token is 1-based). */
function mouse(action: MouseToken["action"], x: number, y: number): MouseToken {
    return {
        kind: "mouse",
        button: "left",
        action,
        x: x + 1,
        y: y + 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    };
}

/** So that drag goes through the real mouse dispatcher. */
function rooted(origin: Offset, options: { bottom?: boolean; right?: boolean } = {}): WorkbenchLayoutElement {
    const layout = new WorkbenchLayoutElement();
    layout.setLeftPanel(new TUIElement());
    layout.setCenterContent(new TUIElement());
    layout.setLeftPanelWidth(20);
    if (options.right === true) {
        layout.setRightPanel(new TUIElement());
        layout.setRightPanelVisible(true);
    }
    if (options.bottom === true) {
        layout.setBottomPanel(new TUIElement());
        layout.setBottomPanelVisible(true);
        layout.setBottomPanelHeight(6);
    }
    layout.setAsRoot();
    layout.localPosition = origin;
    layout.layout(BoxConstraints.tight(new Size(80, 24)));
    return layout;
}

function sashes(layout: WorkbenchLayoutElement): SashElement[] {
    return layout.getChildren().filter((c) => c instanceof SashElement);
}

describe("WorkbenchLayoutElement: dragging sashes with the mouse", () => {
    it("the vertical sidebar sash tracks width by the pointer column, accounting for the layout offset", () => {
        const layout = rooted(new Offset(5, 2));
        const dispatcher = new MouseEventDispatcher();
        // The sash is at column 5 + 20; dragging to column 40 → width 35.
        dispatcher.handleMouseToken(mouse("press", 25, 10), layout);
        dispatcher.handleMouseToken(mouse("move", 40, 3), layout);
        dispatcher.handleMouseToken(mouse("release", 40, 3), layout);
        expect(layout.getLeftPanelWidth()).toBe(35);
    });

    it("the horizontal panel sash tracks height by the pointer row", () => {
        const layout = rooted(new Offset(0, 1), { bottom: true });
        const dispatcher = new MouseEventDispatcher();
        // The panel bottom is row 1 + 24; the top of a 6-row panel is row 19.
        dispatcher.handleMouseToken(mouse("press", 40, 19), layout);
        dispatcher.handleMouseToken(mouse("move", 70, 15), layout);
        dispatcher.handleMouseToken(mouse("release", 70, 15), layout);
        expect(layout.getBottomPanelHeight()).toBe(10);
    });

    it("the vertical right panel sash tracks width by the pointer column, not the row", () => {
        const layout = rooted(new Offset(5, 2), { right: true });
        const dispatcher = new MouseEventDispatcher();
        // The right panel defaults to 20 columns (a quarter of 80): the sash is at column 5 + 60.
        // Drag 10 columns left and 7 rows up → width 30.
        dispatcher.handleMouseToken(mouse("press", 65, 10), layout);
        dispatcher.handleMouseToken(mouse("move", 55, 3), layout);
        dispatcher.handleMouseToken(mouse("release", 55, 3), layout);
        expect(layout.getRightPanelWidth()).toBe(30);
    });

    // Only a real frame clears the frame flag (`needsRepaint`), while the mouse hit test itself
    // clears layout dirtiness — so this is the only way to see the repaint request.
    it.each([
        ["sidebar", 20, 12, 40, 12],
        ["panel", 40, 18, 40, 10],
        ["right panel", 60, 5, 50, 5],
    ])("dragging the %s sash requests a frame", (_name, pressX, pressY, moveX, moveY) => {
        const layout = new WorkbenchLayoutElement();
        layout.setLeftPanel(new TUIElement());
        layout.setCenterContent(new TUIElement());
        layout.setLeftPanelWidth(20);
        layout.setBottomPanel(new TUIElement());
        layout.setBottomPanelVisible(true);
        layout.setBottomPanelHeight(6);
        layout.setRightPanel(new TUIElement());
        layout.setRightPanelVisible(true);
        const app = TestApp.createWithContent(layout, new Size(80, 24));
        app.render();
        expect(layout.needsRepaint).toBe(false);
        const dispatcher = new MouseEventDispatcher();
        dispatcher.handleMouseToken(mouse("press", pressX, pressY), app.root);
        dispatcher.handleMouseToken(mouse("move", moveX, moveY), app.root);
        expect(layout.needsRepaint).toBe(true);
    });
});

describe("WorkbenchLayoutElement: sash hover delay", () => {
    it("hands the delay to all three sashes", () => {
        const layout = rooted(new Offset(0, 0), { right: true, bottom: true });
        layout.setSashHoverDelay(750);
        expect(sashes(layout).map((s) => s.hoverDelay)).toEqual([750, 750, 750]);
    });
});

describe("WorkbenchLayoutElement: commands request the repaint themselves", () => {
    it("width nudge and reset mark the layout dirty", () => {
        const layout = rooted(new Offset(0, 0));
        expect(layout.isLayoutDirty).toBe(false);
        layout.nudgeLeftPanelWidth(3);
        expect(layout.isLayoutDirty).toBe(true);

        layout.layout(BoxConstraints.tight(new Size(80, 24)));
        layout.resetLeftPanelWidth();
        expect(layout.isLayoutDirty).toBe(true);
    });

    it("right width and panel height nudges mark the layout dirty", () => {
        const layout = rooted(new Offset(0, 0), { right: true, bottom: true });
        expect(layout.isLayoutDirty).toBe(false);
        layout.nudgeRightPanelWidth(3);
        expect(layout.isLayoutDirty).toBe(true);

        layout.layout(BoxConstraints.tight(new Size(80, 24)));
        layout.nudgeBottomPanelHeight(2);
        expect(layout.isLayoutDirty).toBe(true);
    });
});

describe("WorkbenchLayoutElement: hidden parts are not laid out", () => {
    it("a visible bottom panel without an element: the sash is hidden, the editor takes the full height", () => {
        const layout = new WorkbenchLayoutElement();
        const center = new TUIElement();
        layout.setCenterContent(center);
        layout.setBottomPanelVisible(true);
        layout.localPosition = new Offset(0, 0);
        layout.layout(BoxConstraints.tight(new Size(80, 24)));
        expect(sashes(layout).every((s) => s.hidden)).toBe(true);
        expect(center.layoutSize).toEqual(new Size(80, 24));
    });

    it("a hidden bottom panel and its sash get no layout", () => {
        const layout = new WorkbenchLayoutElement();
        const bottom = new TUIElement();
        layout.setCenterContent(new TUIElement());
        layout.setBottomPanel(bottom);
        layout.localPosition = new Offset(0, 0);
        layout.layout(BoxConstraints.tight(new Size(80, 24)));
        expect(bottom.isLayoutDirty).toBe(true);
        expect(sashes(layout).at(-1)!.isLayoutDirty).toBe(true);
    });

    it("a hidden right panel and its sash get no layout", () => {
        const layout = new WorkbenchLayoutElement();
        const right = new TUIElement();
        layout.setCenterContent(new TUIElement());
        layout.setRightPanel(right);
        layout.localPosition = new Offset(0, 0);
        layout.layout(BoxConstraints.tight(new Size(80, 24)));
        expect(right.isLayoutDirty).toBe(true);
        expect(sashes(layout)[1].isLayoutDirty).toBe(true);
    });

    it("the sash of a hidden sidebar gets no layout", () => {
        const layout = new WorkbenchLayoutElement();
        layout.setLeftPanel(new TUIElement());
        layout.setCenterContent(new TUIElement());
        layout.setLeftPanelVisible(false);
        layout.localPosition = new Offset(0, 0);
        layout.layout(BoxConstraints.tight(new Size(80, 24)));
        expect(sashes(layout)[0].isLayoutDirty).toBe(true);
    });
});
