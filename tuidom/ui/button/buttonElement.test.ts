import { describe, expect, it, vi } from "vitest";

import { renderElement } from "../../../src/TestUtils/renderElement.ts";
import { TestApp } from "../../../src/TestUtils/TestApp.ts";
import type { MockTerminalBackend } from "../../backend/mockTerminalBackend.ts";
import { packRgb } from "../../common/colorUtils.ts";
import { BoxConstraints, Point, Size } from "../../common/geometryPromitives.ts";
import { TUIKeyboardEvent } from "../../dom/events/tuiKeyboardEvent.ts";
import { TUIMouseEvent } from "../../dom/events/tuiMouseEvent.ts";

import { ButtonElement, unthemedButtonStyles } from "./buttonElement.ts";

const BUTTON_FG = packRgb(204, 204, 204);
const BUTTON_BG = packRgb(60, 60, 60);
const BUTTON_HOVER_BG = packRgb(69, 73, 78);
const BUTTON_SEL_FG = packRgb(255, 255, 255);
const BUTTON_SEL_BG = packRgb(0, 120, 215);
const BUTTON_SEL_HOVER_BG = packRgb(26, 134, 224);

function renderStandalone(button: ButtonElement): MockTerminalBackend {
    return renderElement(button, button.getMaxIntrinsicWidth(0), 1);
}

describe("ButtonElement — metadata & layout", () => {
    it("exposes its label", () => {
        expect(new ButtonElement("OK").getLabel()).toBe("OK");
    });

    it("intrinsic width is label length plus 4 brackets/padding", () => {
        const button = new ButtonElement("OK");
        expect(button.getMinIntrinsicWidth(1)).toBe(6);
        expect(button.getMaxIntrinsicWidth(1)).toBe(6);
    });

    it("intrinsic height is 1", () => {
        const button = new ButtonElement("OK");
        expect(button.getMinIntrinsicHeight(10)).toBe(1);
        expect(button.getMaxIntrinsicHeight(10)).toBe(1);
    });

    it("lays out to a fixed label-sized box", () => {
        const button = new ButtonElement("Save");
        const size = button.layout(BoxConstraints.tight(new Size(40, 5)));
        expect(size).toEqual(new Size("Save".length + 4, 1));
    });
});

describe("ButtonElement — rendering", () => {
    it("renders the label inside brackets with unfocused colors", () => {
        const backend = renderStandalone(new ButtonElement("OK"));
        expect(backend.getTextAt(new Point(0, 0), 6)).toBe("[ OK ]");
        expect(backend.getFgAt(new Point(0, 0))).toBe(BUTTON_FG);
        expect(backend.getBgAt(new Point(0, 0))).toBe(BUTTON_BG);
    });

    it("uses selected colors when focused", () => {
        const button = new ButtonElement("OK");
        const testApp = TestApp.createWithContent(button, new Size(20, 3));
        button.focus();
        testApp.render();

        expect(button.isFocused).toBe(true);
        const pos = button.globalPosition;
        expect(testApp.backend.getFgAt(new Point(pos.x, pos.y))).toBe(BUTTON_SEL_FG);
        expect(testApp.backend.getBgAt(new Point(pos.x, pos.y))).toBe(BUTTON_SEL_BG);
    });
});

describe("ButtonElement — hover", () => {
    function hover(button: ButtonElement, type: "mouseenter" | "mouseleave"): void {
        button.dispatchEvent(new TUIMouseEvent(type, { button: "left", screenX: 0, screenY: 0, localX: 0, localY: 0 }));
    }

    it("uses the hover background while hovered and unfocused", () => {
        const button = new ButtonElement("OK");
        hover(button, "mouseenter");
        const backend = renderStandalone(button);
        expect(backend.getFgAt(new Point(0, 0))).toBe(BUTTON_FG);
        expect(backend.getBgAt(new Point(0, 0))).toBe(BUTTON_HOVER_BG);
    });

    it("reverts to the base background after mouseleave", () => {
        const button = new ButtonElement("OK");
        hover(button, "mouseenter");
        hover(button, "mouseleave");
        const backend = renderStandalone(button);
        expect(backend.getBgAt(new Point(0, 0))).toBe(BUTTON_BG);
    });

    it("uses the focused hover background while hovered and focused", () => {
        const button = new ButtonElement("OK");
        const testApp = TestApp.createWithContent(button, new Size(20, 3));
        button.focus();
        hover(button, "mouseenter");
        testApp.render();

        const pos = button.globalPosition;
        expect(testApp.backend.getFgAt(new Point(pos.x, pos.y))).toBe(BUTTON_SEL_FG);
        expect(testApp.backend.getBgAt(new Point(pos.x, pos.y))).toBe(BUTTON_SEL_HOVER_BG);
    });

    it("honors styles set via setStyles in render", () => {
        const button = new ButtonElement("OK");
        const customHoverBg = packRgb(1, 2, 3);
        button.setStyles({ ...unthemedButtonStyles, hoverBg: customHoverBg });
        hover(button, "mouseenter");
        const backend = renderStandalone(button);
        expect(backend.getBgAt(new Point(0, 0))).toBe(customHoverBg);
    });

    it("honors styles passed via constructor options in render", () => {
        const customBg = packRgb(7, 8, 9);
        const button = new ButtonElement("OK", { styles: { ...unthemedButtonStyles, bg: customBg } });
        const backend = renderStandalone(button);
        expect(backend.getBgAt(new Point(0, 0))).toBe(customBg);
    });

    it("ignores a repeated mouseenter without re-marking dirty", () => {
        const button = new ButtonElement("OK");
        hover(button, "mouseenter");
        const markDirty = vi.spyOn(button, "markDirty");
        hover(button, "mouseenter");
        expect(markDirty).not.toHaveBeenCalled();
        expect(renderStandalone(button).getBgAt(new Point(0, 0))).toBe(BUTTON_HOVER_BG);
    });

    it("ignores mouseleave when not hovered", () => {
        const button = new ButtonElement("OK");
        const markDirty = vi.spyOn(button, "markDirty");
        hover(button, "mouseleave");
        expect(markDirty).not.toHaveBeenCalled();
        expect(renderStandalone(button).getBgAt(new Point(0, 0))).toBe(BUTTON_BG);
    });
});

describe("ButtonElement — activation", () => {
    it("activates on Enter and prevents default", () => {
        const button = new ButtonElement("OK");
        const onActivate = vi.fn();
        button.onActivate = onActivate;

        const event = new TUIKeyboardEvent("keydown", { key: "Enter" });
        button.dispatchEvent(event);

        expect(onActivate).toHaveBeenCalledOnce();
        expect(event.defaultPrevented).toBe(true);
    });

    it("activates on Space", () => {
        const button = new ButtonElement("OK");
        const onActivate = vi.fn();
        button.onActivate = onActivate;

        button.dispatchEvent(new TUIKeyboardEvent("keydown", { key: " " }));

        expect(onActivate).toHaveBeenCalledOnce();
    });

    it("ignores other keys", () => {
        const button = new ButtonElement("OK");
        const onActivate = vi.fn();
        button.onActivate = onActivate;

        button.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "a" }));

        expect(onActivate).not.toHaveBeenCalled();
    });

    it("ignores non-keydown events (e.g. keyup)", () => {
        const button = new ButtonElement("OK");
        const onActivate = vi.fn();
        button.onActivate = onActivate;

        button.dispatchEvent(new TUIKeyboardEvent("keyup", { key: "Enter" }));

        expect(onActivate).not.toHaveBeenCalled();
    });

    it("activates on click", () => {
        const button = new ButtonElement("OK");
        const onActivate = vi.fn();
        button.onActivate = onActivate;

        button.dispatchEvent(
            new TUIMouseEvent("click", { button: "left", screenX: 0, screenY: 0, localX: 0, localY: 0 }),
        );

        expect(onActivate).toHaveBeenCalledOnce();
    });

    it("does not activate on click when default is already prevented", () => {
        const button = new ButtonElement("OK");
        const onActivate = vi.fn();
        button.onActivate = onActivate;

        const event = new TUIMouseEvent("click", { button: "left", screenX: 0, screenY: 0, localX: 0, localY: 0 });
        event.preventDefault();
        button.dispatchEvent(event);

        expect(onActivate).not.toHaveBeenCalled();
    });

    it("does not throw on activation without an onActivate handler", () => {
        const button = new ButtonElement("OK");
        expect(() => button.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }))).not.toThrow();
    });
});
