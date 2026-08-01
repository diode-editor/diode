import { describe, expect, it } from "vitest";

import { TestApp } from "../../../src/TestUtils/TestApp.ts";
import { Point, Size } from "../../common/geometryPromitives.ts";
import { TUIMouseEvent } from "../../dom/events/tuiMouseEvent.ts";
import { InputElement } from "../inputbox/inputElement.ts";
import { PopupMenuElement } from "../menu/popupMenuElement.ts";

function mousedownOn(app: TestApp, target: { dispatchEvent: (e: TUIMouseEvent) => void }): void {
    target.dispatchEvent(
        new TUIMouseEvent("mousedown", { button: "left", screenX: 25, screenY: 8, localX: 0, localY: 0 }),
    );
}

describe("OverlayLayer — ownsTarget и shouldCloseOnEscape", () => {
    it("ownsTarget=true оставляет сессию при клике по чужому элементу", () => {
        const input = new InputElement();
        const app = TestApp.createWithContent(input, new Size(40, 12));
        const menu = new PopupMenuElement([{ label: "Copy" }]);
        const buddy = new PopupMenuElement([{ label: "Nested" }]);
        app.root.overlayLayer.addItem(buddy, new Point(20, 5), true);

        const session = app.root.overlayLayer.openPopupSession(
            menu,
            { screenX: 2, screenY: 1 },
            {
                visible: true,
                pointerPolicy: "close-on-outside",
                ownsTarget: (target) => target === buddy,
            },
        );

        mousedownOn(app, buddy);
        expect(session.isOpen()).toBe(true);

        mousedownOn(app, input);
        expect(session.isOpen()).toBe(false);
    });

    it("shouldCloseOnEscape=false отдаёт Escape владельцу, true — закрывает", () => {
        const input = new InputElement();
        const app = TestApp.createWithContent(input, new Size(40, 12));
        const menu = new PopupMenuElement([{ label: "Copy" }]);
        let allowClose = false;

        const session = app.root.overlayLayer.openPopupSession(
            menu,
            { screenX: 2, screenY: 1 },
            {
                visible: true,
                focusOnOpen: true,
                closeOnEscape: true,
                pointerPolicy: "close-on-outside",
                shouldCloseOnEscape: () => allowClose,
            },
        );

        app.sendKey("Escape");
        expect(session.isOpen()).toBe(true);

        allowClose = true;
        app.sendKey("Escape");
        expect(session.isOpen()).toBe(false);
    });
});
