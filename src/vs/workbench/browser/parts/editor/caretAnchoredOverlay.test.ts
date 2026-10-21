import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";

import { CaretAnchoredOverlay } from "./caretAnchoredOverlay.ts";

/** A three-line popup on an 80×24 screen. */
function setup(): { body: BodyElement; app: TestApp; element: TextLabelElement; overlay: CaretAnchoredOverlay } {
    const body = new BodyElement();
    const app = TestApp.create(body, new Size(80, 24));
    const element = new TextLabelElement("one\ntwo\nthree");
    element.id = "probe";
    const overlay = new CaretAnchoredOverlay(body, element);
    return { body, app, element, overlay };
}

describe("CaretAnchoredOverlay", () => {
    it("creates a hidden session on the host layer", () => {
        const { body, element, overlay } = setup();

        expect(body.overlayLayer.querySelector("#probe")).toBe(element);
        expect(overlay.isOpen()).toBe(false);
        expect(body.overlayLayer.hasVisibleItems()).toBe(false);
        overlay.dispose();
    });

    it("openAt opens, close closes and is idempotent", () => {
        const { overlay } = setup();

        overlay.openAt({ screenX: 5, screenY: 5, preferBelow: true });
        expect(overlay.isOpen()).toBe(true);

        overlay.close();
        overlay.close();
        expect(overlay.isOpen()).toBe(false);
        overlay.dispose();
    });

    it("below (default): popup under the cursor line", () => {
        const { app, element, overlay } = setup();

        overlay.openAt({ screenX: 10, screenY: 12, preferBelow: true });
        app.render();

        expect(element.globalPosition.x).toBe(10);
        expect(element.globalPosition.y).toBe(13);
        overlay.dispose();
    });

    it("aboveElseBelow: above the cursor line if there is room above (inclusive bound)", () => {
        const { app, element, overlay } = setup();
        const height = element.getMaxIntrinsicHeight(element.getMaxIntrinsicWidth(0));

        overlay.openAt({ screenX: 10, screenY: 12, preferBelow: true }, "aboveElseBelow");
        app.render();
        expect(element.globalPosition.y).toBe(12 - height);

        overlay.openAt({ screenX: 10, screenY: height, preferBelow: true }, "aboveElseBelow");
        app.render();
        expect(element.globalPosition.y).toBe(0);
        overlay.dispose();
    });

    it("aboveElseBelow: no room above — below the cursor, not over it", () => {
        const { app, element, overlay } = setup();
        const height = element.getMaxIntrinsicHeight(element.getMaxIntrinsicWidth(0));

        overlay.openAt({ screenX: 10, screenY: height - 1, preferBelow: true }, "aboveElseBelow");
        app.render();

        expect(element.globalPosition.y).toBe(height);
        overlay.dispose();
    });

    it("setAnchor moves an open popup and does not open it by itself", () => {
        const { app, element, overlay } = setup();

        overlay.setAnchor({ screenX: 3, screenY: 3, preferBelow: true });
        expect(overlay.isOpen()).toBe(false);

        overlay.openAt({ screenX: 10, screenY: 5, preferBelow: true });
        overlay.setAnchor({ screenX: 20, screenY: 8, preferBelow: true });
        app.render();
        expect(element.globalPosition.x).toBe(20);
        expect(element.globalPosition.y).toBe(9);
        overlay.dispose();
    });

    it("dispose removes the session from the layer", () => {
        const { body, overlay } = setup();
        overlay.openAt({ screenX: 5, screenY: 5, preferBelow: true });

        overlay.dispose();

        expect(body.overlayLayer.hasVisibleItems()).toBe(false);
        expect(body.overlayLayer.querySelector("#probe")).toBeNull();
    });
});
