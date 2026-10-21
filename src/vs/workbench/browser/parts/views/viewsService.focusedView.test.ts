import { Point } from "@tuidom/core/common/geometryPromitives";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";

import { makeViewsHarness, testView } from "./viewsService.testUtils.ts";

const PANEL = "workbench.panel.output";

/** A panel container with two sections inside a window (BodyElement) with an overlay layer. */
function scene() {
    const h = makeViewsHarness();
    const first = testView("first", PANEL, 10);
    const second = testView("second", PANEL, 20, { body: null, placeholder: "nothing yet" });
    h.service.registerContainer({ id: PANEL, title: "OUTPUT", location: "panel" });
    h.service.registerView(first);
    h.service.registerView(second);
    h.service.attachContainer(PANEL);
    const body = new BodyElement();
    body.setContent(h.root(PANEL));
    const popup = new TUIElement();
    body.getOverlayLayer().addItem(popup, new Point(0, 0));
    const keys = new ContextKeyService();
    return { h, first: first.body!, popup, keys, body };
}

describe("ViewsService — focused view (focusedView)", () => {
    it("focus in a section body yields its id", () => {
        const { h, first } = scene();
        expect(h.service.getFocusedViewId(first)).toBe("first");
    });

    it("focus in a section's empty state also yields its id", () => {
        const { h } = scene();
        const placeholder = h.paneView(PANEL).querySelector("#viewPlaceholder-second")!;
        expect(h.service.getFocusedViewId(placeholder)).toBe("second");
    });

    it("focus outside views and no focus yield null", () => {
        const { h, body } = scene();
        expect(h.service.getFocusedViewId(body)).toBeNull();
        expect(h.service.getFocusedViewId(null)).toBeNull();
        expect(h.service.getFocusedViewId(new TUIElement())).toBeNull();
    });

    it("context key: view → its id; moving to another part of the window clears it", () => {
        const { h, first, body, keys } = scene();
        h.service.updateContextKeys(keys, first);
        expect(keys.get("focusedView")).toBe("first");
        h.service.updateContextKeys(keys, body);
        expect(keys.get("focusedView")).toBe("");
    });

    it("focus in an overlay (palette) and a transient null do not reset the key", () => {
        const { h, first, popup, keys } = scene();
        h.service.updateContextKeys(keys, first);
        h.service.updateContextKeys(keys, null);
        expect(keys.get("focusedView")).toBe("first");
        h.service.updateContextKeys(keys, popup);
        expect(keys.get("focusedView")).toBe("first");
    });
});
