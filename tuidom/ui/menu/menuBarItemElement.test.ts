import { describe, expect, it, vi } from "vitest";

import { renderElement } from "../../../src/TestUtils/renderElement.ts";
import type { MockTerminalBackend } from "../../backend/mockTerminalBackend.ts";
import { DEFAULT_COLOR } from "../../common/colorUtils.ts";
import { Point } from "../../common/geometryPromitives.ts";
import { TUIMouseEvent } from "../../dom/events/tuiMouseEvent.ts";
import { STYLE_TOKEN_DEFAULTS } from "../../dom/styles/styleTokens.ts";

import { MenuBarFillerElement, MenuBarItemElement } from "./menuBarItemElement.tsx";

const MENU_BAR_BG = STYLE_TOKEN_DEFAULTS["menuBar.background"];
const ACTIVE_MENU_BG = STYLE_TOKEN_DEFAULTS["menubar.selectionBackground"];

function render(element: MenuBarItemElement | MenuBarFillerElement, width?: number): MockTerminalBackend {
    const w = width ?? element.getMaxIntrinsicWidth(0);
    const h = element.getMaxIntrinsicHeight(w);
    return renderElement(element, w, h, { resolveStyles: true });
}

function clickEvent(): TUIMouseEvent {
    return new TUIMouseEvent("click", { button: "left", screenX: 0, screenY: 0, localX: 0, localY: 0 });
}

function mousemoveEvent(): TUIMouseEvent {
    return new TUIMouseEvent("mousemove", { button: "none", screenX: 0, screenY: 0, localX: 0, localY: 0 });
}

describe("MenuBarItemElement — metadata", () => {
    it("exposes label and mnemonic", () => {
        const item = new MenuBarItemElement("File", "F");
        expect(item.label).toBe("File");
        expect(item.mnemonic).toBe("F");
    });

    it("defaults active to false", () => {
        expect(new MenuBarItemElement("File").active).toBe(false);
    });
});

describe("MenuBarItemElement — active state", () => {
    it("toggles active and switches the background color", () => {
        // Обычный пункт НАСЛЕДУЕТ фон полосы (его задаёт MenuBarElement
        // токенами menuBar.*): standalone-рендер наследует прозрачный корень.
        const item = new MenuBarItemElement("File");
        expect(render(item).getBgAt(new Point(0, 0))).toBe(DEFAULT_COLOR);

        item.active = true;
        expect(item.active).toBe(true);
        expect(render(item).getBgAt(new Point(0, 0))).toBe(ACTIVE_MENU_BG);
    });

    it("ignores a redundant set to the same value", () => {
        const item = new MenuBarItemElement("File");
        item.active = false; // unchanged — early return
        expect(item.active).toBe(false);
    });
});

describe("MenuBarItemElement — activation", () => {
    it("invokes onActivate on click", () => {
        const item = new MenuBarItemElement("File");
        const onActivate = vi.fn();
        item.onActivate = onActivate;

        item.dispatchEvent(clickEvent());

        expect(onActivate).toHaveBeenCalledOnce();
    });

    it("does nothing on click when default is prevented", () => {
        const item = new MenuBarItemElement("File");
        const onActivate = vi.fn();
        item.onActivate = onActivate;

        const event = clickEvent();
        event.preventDefault();
        item.dispatchEvent(event);

        expect(onActivate).not.toHaveBeenCalled();
    });

    it("does not throw on click without an onActivate handler", () => {
        const item = new MenuBarItemElement("File");
        expect(() => item.dispatchEvent(clickEvent())).not.toThrow();
    });
});

describe("MenuBarItemElement — hover", () => {
    it("invokes onHover on mousemove", () => {
        const item = new MenuBarItemElement("File");
        const onHover = vi.fn();
        item.onHover = onHover;

        item.dispatchEvent(mousemoveEvent());

        expect(onHover).toHaveBeenCalledOnce();
    });

    it("does nothing on mousemove when default is prevented", () => {
        const item = new MenuBarItemElement("File");
        const onHover = vi.fn();
        item.onHover = onHover;

        const event = mousemoveEvent();
        event.preventDefault();
        item.dispatchEvent(event);

        expect(onHover).not.toHaveBeenCalled();
    });

    it("does not throw on mousemove without an onHover handler", () => {
        const item = new MenuBarItemElement("File");
        expect(() => item.dispatchEvent(mousemoveEvent())).not.toThrow();
    });
});

describe("MenuBarItemElement — rendering & mnemonic", () => {
    it("renders the label padded with spaces", () => {
        const backend = render(new MenuBarItemElement("File", "F"));
        expect(backend.getTextAt(new Point(0, 0), 6)).toBe(" File ");
    });

    it("renders when the mnemonic is not present in the label (no underline)", () => {
        const backend = render(new MenuBarItemElement("File", "z"));
        expect(backend.getTextAt(new Point(0, 0), 6)).toBe(" File ");
    });

    it("falls back to the first label character when no mnemonic is given", () => {
        const backend = render(new MenuBarItemElement("Edit"));
        expect(backend.getTextAt(new Point(0, 0), 6)).toBe(" Edit ");
    });

    it("handles an empty label", () => {
        expect(() => render(new MenuBarItemElement(""), 2)).not.toThrow();
    });
});

describe("MenuBarFillerElement", () => {
    it("has zero width and unit height intrinsics", () => {
        const filler = new MenuBarFillerElement();
        expect(filler.getMinIntrinsicWidth(0)).toBe(0);
        expect(filler.getMaxIntrinsicWidth(0)).toBe(0);
        expect(filler.getMinIntrinsicHeight(0)).toBe(1);
        expect(filler.getMaxIntrinsicHeight(0)).toBe(1);
    });

    it("заливает свою ширину унаследованным фоном (полосу красит MenuBarElement)", () => {
        const filler = new MenuBarFillerElement();
        const backend = render(filler, 4);
        expect(backend.getBgAt(new Point(0, 0))).toBe(DEFAULT_COLOR);
        expect(backend.getBgAt(new Point(3, 0))).toBe(DEFAULT_COLOR);
    });
});
