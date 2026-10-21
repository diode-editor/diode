import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { validateTree } from "@tuidom/core/dom/validateTree";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

import { PanelContainerElement } from "./panelContainerElement.ts";

/**
 * The order that caught the #204 family of bugs: a child is attached before the
 * panel is rooted, and the tab becomes active without a click. With a stale root
 * `focus()`/`open()` silently do nothing.
 */
function rootInto(container: TUIElement): BodyElement {
    const body = new BodyElement();
    body.setContent(container);
    return body;
}

describe("PanelContainerElement: tree contract", () => {
    it("active tab content attached before rooting is fully in the tree", () => {
        const panel = new PanelContainerElement();
        const child = new TUIElement();
        panel.addView({ id: "first", title: "FIRST", content: child });
        expect(child.getRoot()).toBeNull();

        const body = rootInto(panel);

        expect(child.getParent()).not.toBeNull();
        expect(child.getRoot()).toBe(body);
        expect(validateTree(body)).toEqual([]);
    });

    it("active tab controls attached before rooting are fully in the tree", () => {
        const panel = new PanelContainerElement();
        const child = new TUIElement();
        panel.addView({ id: "first", title: "FIRST", content: null, actions: child });

        const body = rootInto(panel);

        expect(child.getParent()).not.toBeNull();
        expect(child.getRoot()).toBe(body);
        expect(validateTree(body)).toEqual([]);
    });

    it("an inactive tab is rooted on activation", () => {
        const panel = new PanelContainerElement();
        const first = new TUIElement();
        const second = new TUIElement();
        panel.addView({ id: "first", title: "FIRST", content: first });
        panel.addView({ id: "second", title: "SECOND", content: second });

        const body = rootInto(panel);
        panel.setActiveView("second");

        expect(second.getRoot()).toBe(body);
        expect(validateTree(body)).toEqual([]);
    });

    it("tab controls attached before rooting are rooted after activation", () => {
        const panel = new PanelContainerElement();
        const actions = new TUIElement();
        panel.addView({ id: "output", title: "OUTPUT", content: null });
        panel.setViewActions("output", actions);

        const inactive = new TUIElement();
        panel.addView({ id: "other", title: "OTHER", content: inactive });
        panel.setActiveView("other");

        const body = rootInto(panel); // while another tab is active
        panel.setActiveView("output");

        expect(actions.getRoot()).toBe(body);
        expect(validateTree(body)).toEqual([]);
    });
});
