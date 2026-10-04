import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";

import { CaretAnchoredOverlay } from "./caretAnchoredOverlay.ts";

/** Попап в три строки высотой на экране 80×24. */
function setup(): { body: BodyElement; app: TestApp; element: TextLabelElement; overlay: CaretAnchoredOverlay } {
    const body = new BodyElement();
    const app = TestApp.create(body, new Size(80, 24));
    const element = new TextLabelElement("one\ntwo\nthree");
    element.id = "probe";
    const overlay = new CaretAnchoredOverlay(body, element);
    return { body, app, element, overlay };
}

describe("CaretAnchoredOverlay", () => {
    it("создаёт скрытую сессию на слое хоста", () => {
        const { body, element, overlay } = setup();

        expect(body.overlayLayer.querySelector("#probe")).toBe(element);
        expect(overlay.isOpen()).toBe(false);
        expect(body.overlayLayer.hasVisibleItems()).toBe(false);
        overlay.dispose();
    });

    it("openAt открывает, close закрывает и идемпотентен", () => {
        const { overlay } = setup();

        overlay.openAt({ screenX: 5, screenY: 5, preferBelow: true });
        expect(overlay.isOpen()).toBe(true);

        overlay.close();
        overlay.close();
        expect(overlay.isOpen()).toBe(false);
        overlay.dispose();
    });

    it("below (по умолчанию): попап под строкой каретки", () => {
        const { app, element, overlay } = setup();

        overlay.openAt({ screenX: 10, screenY: 12, preferBelow: true });
        app.render();

        expect(element.globalPosition.x).toBe(10);
        expect(element.globalPosition.y).toBe(13);
        overlay.dispose();
    });

    it("aboveElseBelow: над строкой каретки, если сверху хватает места (граница включительная)", () => {
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

    it("aboveElseBelow: сверху места нет — под кареткой, а не поверх неё", () => {
        const { app, element, overlay } = setup();
        const height = element.getMaxIntrinsicHeight(element.getMaxIntrinsicWidth(0));

        overlay.openAt({ screenX: 10, screenY: height - 1, preferBelow: true }, "aboveElseBelow");
        app.render();

        expect(element.globalPosition.y).toBe(height);
        overlay.dispose();
    });

    it("setAnchor двигает открытый попап и сам его не открывает", () => {
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

    it("dispose снимает сессию со слоя", () => {
        const { body, overlay } = setup();
        overlay.openAt({ screenX: 5, screenY: 5, preferBelow: true });

        overlay.dispose();

        expect(body.overlayLayer.hasVisibleItems()).toBe(false);
        expect(body.overlayLayer.querySelector("#probe")).toBeNull();
    });
});
