import { describe, expect, it } from "vitest";

import { Offset, Point } from "../../common/geometryPromitives.ts";
import { TUIElement } from "../tuiElement.ts";

import { contextMenuEventFromClick, contextMenuEventFromKeydown } from "./contextMenuEventSource.ts";
import { TUIKeyboardEvent } from "./tuiKeyboardEvent.ts";
import { TUIMouseEvent } from "./tuiMouseEvent.ts";

function makeClick(button: "left" | "middle" | "right" | "none"): TUIMouseEvent {
    return new TUIMouseEvent("click", {
        button,
        screenX: 12,
        screenY: 7,
        localX: 3,
        localY: 2,
        shiftKey: true,
        altKey: true,
        ctrlKey: true,
    });
}

describe("contextMenuEventFromClick", () => {
    it("maps a right click to a bubbling contextmenu event with the same anchor", () => {
        const event = contextMenuEventFromClick(makeClick("right"));

        expect(event).not.toBeNull();
        expect(event?.type).toBe("contextmenu");
        expect(event?.trigger).toBe("mouse");
        expect(event?.bubbles).toBe(true);
        expect(event).toMatchObject({
            button: "right",
            screenX: 12,
            screenY: 7,
            localX: 3,
            localY: 2,
            shiftKey: true,
            altKey: true,
            ctrlKey: true,
        });
    });

    it("returns null for other buttons", () => {
        expect(contextMenuEventFromClick(makeClick("left"))).toBeNull();
        expect(contextMenuEventFromClick(makeClick("middle"))).toBeNull();
        expect(contextMenuEventFromClick(makeClick("none"))).toBeNull();
    });
});

describe("contextMenuEventFromKeydown", () => {
    function makeTarget(): TUIElement {
        const target = new TUIElement();
        target.localPosition = new Offset(5, 9);
        return target;
    }

    function keydown(init: {
        key: string;
        shiftKey?: boolean;
        ctrlKey?: boolean;
        altKey?: boolean;
        metaKey?: boolean;
    }): TUIKeyboardEvent {
        return new TUIKeyboardEvent("keydown", init);
    }

    it("maps the ContextMenu key to a keyboard-triggered contextmenu anchored at the target", () => {
        const event = contextMenuEventFromKeydown(keydown({ key: "ContextMenu" }), makeTarget());

        expect(event).not.toBeNull();
        expect(event?.type).toBe("contextmenu");
        expect(event?.trigger).toBe("keyboard");
        expect(event).toMatchObject({ button: "none", screenX: 5, screenY: 9, localX: 0, localY: 0 });
    });

    it("maps Shift+F10 and preserves the shift modifier", () => {
        const event = contextMenuEventFromKeydown(keydown({ key: "F10", shiftKey: true }), makeTarget());

        expect(event?.trigger).toBe("keyboard");
        expect(event?.shiftKey).toBe(true);
    });

    it("returns null for F10 without shift and for unrelated keys", () => {
        expect(contextMenuEventFromKeydown(keydown({ key: "F10" }), makeTarget())).toBeNull();
        expect(contextMenuEventFromKeydown(keydown({ key: "Enter" }), makeTarget())).toBeNull();
    });

    it("returns null when ctrl, alt or meta are held", () => {
        expect(contextMenuEventFromKeydown(keydown({ key: "ContextMenu", ctrlKey: true }), makeTarget())).toBeNull();
        expect(contextMenuEventFromKeydown(keydown({ key: "ContextMenu", altKey: true }), makeTarget())).toBeNull();
        expect(
            contextMenuEventFromKeydown(keydown({ key: "F10", shiftKey: true, metaKey: true }), makeTarget()),
        ).toBeNull();
    });
});
