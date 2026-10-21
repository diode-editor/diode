import { Point } from "@tuidom/core/common/geometryPromitives";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import type { RenderContext } from "@tuidom/core/dom/tuiElement";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { describe, expect, it, vi } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";

import { PanelContainerElement } from "./panelContainerElement.ts";

class LabelStub extends TUIElement {
    public constructor(private readonly label: string) {
        super();
    }

    public override getMinIntrinsicWidth(): number {
        return this.label.length;
    }

    public override getMaxIntrinsicWidth(): number {
        return this.label.length;
    }

    public override getMinIntrinsicHeight(): number {
        return 1;
    }

    public override getMaxIntrinsicHeight(): number {
        return 1;
    }

    public override render(context: RenderContext): void {
        for (let i = 0; i < this.label.length; i++) {
            context.setCell(i, 0, { char: this.label[i] });
        }
    }
}

/** A theme is required: the `×` button reads our tokens, which have no engine defaults. */
function render(panel: PanelContainerElement, width: number, height = 8) {
    return renderElement(panel, width, height, { themeVars: true });
}

function panelWithActions(actions: TUIElement | null, width = 60) {
    const panel = new PanelContainerElement();
    panel.addView({ id: "problems", title: "PROBLEMS", content: null });
    panel.addView({ id: "output", title: "OUTPUT", content: null, actions });
    panel.setActiveView("output");
    const backend = render(panel, width);
    return { panel, backend, text: backend.screenToString() };
}

describe("PanelContainerElement: tab controls in the header", () => {
    it("draws the active tab's controls right next to the close button", () => {
        const { backend } = panelWithActions(new LabelStub("Bootstrap"));

        // The label must end at the `×` button, not right after the tabs.
        const row = backend.getTextAt(new Point(0, 1), 60);
        expect(row).toContain("PROBLEMS");
        expect(row.trimEnd().endsWith("Bootstrap ×")).toBe(true);
    });

    it("an inactive tab's controls are not shown", () => {
        const panel = new PanelContainerElement();
        panel.addView({ id: "output", title: "OUTPUT", content: null, actions: new LabelStub("Bootstrap") });
        panel.addView({ id: "problems", title: "PROBLEMS", content: null });
        panel.setActiveView("problems");

        const backend = render(panel, 60);

        expect(backend.screenToString()).not.toContain("Bootstrap");
    });

    it("setViewActions replaces and removes controls", () => {
        const { panel } = panelWithActions(new LabelStub("Bootstrap"));

        panel.setViewActions("output", new LabelStub("Extensions"));
        expect(render(panel, 60).screenToString()).toContain("Extensions");

        panel.setViewActions("output", null);
        expect(render(panel, 60).screenToString()).not.toContain("Extensions");
    });

    it("setViewActions for an unknown tab — no-op", () => {
        const { panel } = panelWithActions(null);
        expect(() => {
            panel.setViewActions("nope", new LabelStub("X"));
        }).not.toThrow();
    });

    it("controls do not overlap the tabs when space is tight", () => {
        const { backend } = panelWithActions(new LabelStub("VeryLongChannelName"), 30);

        const row = backend.getTextAt(new Point(0, 1), 30);
        expect(row).toContain("PROBLEMS");
        expect(row).toContain("OUTPUT");
    });

    it("controls are drawn even when there are no tabs yet", () => {
        const panel = new PanelContainerElement();
        panel.addView({ id: "output", title: "", content: null, actions: new LabelStub("Bootstrap") });

        expect(render(panel, 40, 6).screenToString()).toContain("Bootstrap");
    });

    it("a click on the controls does not switch the tab", () => {
        // A coordinate INSIDE a tab segment: right of the tabs there is no tab, so a
        // missing source check is indistinguishable there. All that matters is that target is not the panel.
        const actions = new LabelStub("Bootstrap");
        const { panel } = panelWithActions(actions);
        const onActivate = vi.fn();
        panel.onActivateView = onActivate;

        actions.dispatchEvent(
            new TUIMouseEvent("mousedown", { button: "left", screenX: 3, screenY: 1, localX: 0, localY: 0 }),
        );

        expect(onActivate).not.toHaveBeenCalled();
        expect(panel.getActiveViewId()).toBe("output");
    });

    it("a click on the tab itself switches the tab", () => {
        const { panel } = panelWithActions(new LabelStub("Bootstrap"));
        const onActivate = vi.fn();
        panel.onActivateView = onActivate;

        panel.dispatchEvent(
            new TUIMouseEvent("mousedown", { button: "left", screenX: 3, screenY: 1, localX: 3, localY: 1 }),
        );

        expect(onActivate).toHaveBeenCalledWith("problems");
        expect(panel.getActiveViewId()).toBe("problems");
    });
});
