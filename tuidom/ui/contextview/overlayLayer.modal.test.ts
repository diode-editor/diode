import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../testing/TestApp.ts";
import { BoxConstraints, Point, Size } from "../../common/geometryPromitives.ts";
import { TUIElement } from "../../dom/tuiElement.ts";
import type { MouseToken } from "../../input/rawTerminalToken.ts";

import type { OverlayLayer } from "./overlayLayer.ts";

// Compile-time guard: `pointerPolicy` is a required session option, so a session
// can never be created without declaring its outside-click behavior. If this stops
// being an error, the `@ts-expect-error` becomes unused and `tsc` fails the build.
function pointerPolicyIsRequired(layer: OverlayLayer, element: TUIElement): void {
    // @ts-expect-error — missing required `pointerPolicy`.
    layer.createSession(element, new Point(0, 0), { visible: true });
}
void pointerPolicyIsRequired;

/** Element that lays out to a fixed footprint, so overlay bounds are deterministic. */
class FixedSizeElement extends TUIElement {
    private readonly desired: Size;

    public constructor(desired: Size) {
        super();
        this.desired = desired;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const target = constraints.constrain(this.desired);
        return super.performLayout(BoxConstraints.tight(target));
    }
}

function pressToken(screenX: number, screenY: number): MouseToken {
    // MouseToken coordinates are 1-based; the dispatcher subtracts 1.
    return {
        kind: "mouse",
        action: "press",
        button: "left",
        x: screenX + 1,
        y: screenY + 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    };
}

describe("OverlayLayer — modal pointer policy", () => {
    it("swallows outside clicks instead of letting them fall through to content", () => {
        const content = new TUIElement();
        const app = TestApp.createWithContent(content, new Size(40, 20));

        const modal = new FixedSizeElement(new Size(10, 4));
        app.root.overlayLayer.createSession(modal, new Point(15, 8), {
            visible: true,
            pointerPolicy: "modal",
        });
        app.render();

        // A point clearly outside the modal box resolves to the modal itself, not content.
        expect(app.root.elementFromPoint(new Point(0, 0))).toBe(modal);
        // A point inside the modal box still resolves to the modal.
        expect(app.root.elementFromPoint(new Point(15, 8))).toBe(modal);
    });

    it("does not deliver an outside mousedown to the element behind it", () => {
        const content = new TUIElement();
        const contentMouseDown = vi.fn();
        content.addEventListener("mousedown", contentMouseDown);

        const app = TestApp.createWithContent(content, new Size(40, 20));

        // Control: with no modal open, an outside click reaches the content.
        app.backend.simulateMouse(pressToken(0, 0));
        expect(contentMouseDown).toHaveBeenCalledTimes(1);
        contentMouseDown.mockClear();

        // Open a modal; now the same outside click must be blocked.
        const modal = new FixedSizeElement(new Size(10, 4));
        app.root.overlayLayer.createSession(modal, new Point(15, 8), {
            visible: true,
            pointerPolicy: "modal",
        });
        app.render();

        app.backend.simulateMouse(pressToken(0, 0));
        expect(contentMouseDown).not.toHaveBeenCalled();
    });

    it("lets a popup stacked above the modal still receive its own clicks", () => {
        const content = new TUIElement();
        const app = TestApp.createWithContent(content, new Size(40, 20));

        const modal = new FixedSizeElement(new Size(10, 4));
        app.root.overlayLayer.createSession(modal, new Point(2, 2), {
            visible: true,
            pointerPolicy: "modal",
        });

        // Opened after the modal → higher in z-order, hit-tested first.
        const popup = new FixedSizeElement(new Size(6, 3));
        app.root.overlayLayer.createSession(popup, new Point(20, 10), {
            visible: true,
            pointerPolicy: "passthrough",
        });
        app.render();

        // On the upper popup → the popup wins.
        expect(app.root.elementFromPoint(new Point(20, 10))).toBe(popup);
        // Outside both → swallowed by the modal, never reaching content.
        expect(app.root.elementFromPoint(new Point(38, 18))).toBe(modal);
    });

    it("stops swallowing once the modal session is closed", () => {
        const content = new TUIElement();
        const app = TestApp.createWithContent(content, new Size(40, 20));

        const modal = new FixedSizeElement(new Size(10, 4));
        const session = app.root.overlayLayer.createSession(modal, new Point(15, 8), {
            visible: true,
            pointerPolicy: "modal",
        });
        app.render();
        expect(app.root.elementFromPoint(new Point(0, 0))).toBe(modal);

        session.close();
        app.render();

        // Closed → outside clicks fall through to content again.
        expect(app.root.elementFromPoint(new Point(0, 0))).toBe(content);
    });
});
