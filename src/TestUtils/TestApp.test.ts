import { describe, expect, it, vi } from "vitest";

import { Size } from "../../tuidom/common/geometryPromitives.ts";
import type { TUIKeyboardEvent } from "../../tuidom/dom/events/tuiKeyboardEvent.ts";
import { TUIElement } from "../../tuidom/dom/tuiElement.ts";
import { BodyElement } from "../../tuidom/ui/body/bodyElement.ts";
import { BoxElement } from "../../tuidom/ui/layout/boxElement.ts";

import { TestApp } from "./TestApp.ts";

class ContainerElement extends TUIElement {
    public addChild(child: TUIElement): void {
        this.appendChild(child);
    }
}

function createBody(content: TUIElement): BodyElement {
    const body = new BodyElement();
    body.setContent(content);
    return body;
}

describe("TestApp", () => {
    it("creates app with root element", () => {
        const body = createBody(new ContainerElement());
        const testApp = TestApp.create(body, new Size(20, 5));

        expect(testApp.root).toBe(body);
    });

    it("sendKey delivers keyboard event to focused element", () => {
        const container = new ContainerElement();
        const child = new TUIElement();
        child.tabIndex = 0;
        container.addChild(child);

        const testApp = TestApp.create(createBody(container), new Size(20, 5));
        child.focus();

        const handler = vi.fn<(event: TUIKeyboardEvent) => void>();
        child.addEventListener("keydown", handler);
        testApp.sendKey("a");

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].key).toBe("a");
    });

    it("querySelector delegates to root", () => {
        const container = new ContainerElement();
        const box = new BoxElement();
        box.id = "main-box";
        container.addChild(box);

        const testApp = TestApp.create(createBody(container), new Size(20, 5));

        expect(testApp.querySelector("#main-box")).toBe(box);
        expect(testApp.querySelector("BoxElement")).toBe(box);
    });

    it("querySelectorAll delegates to root", () => {
        const container = new ContainerElement();
        const a = new TUIElement();
        a.role = "item";
        const b = new TUIElement();
        b.role = "item";
        container.addChild(a);
        container.addChild(b);

        const testApp = TestApp.create(createBody(container), new Size(20, 5));

        expect(testApp.querySelectorAll("@item")).toEqual([a, b]);
    });

    it("focusedElement returns currently focused element", () => {
        const container = new ContainerElement();
        const a = new TUIElement();
        a.tabIndex = 0;
        a.role = "first";
        const b = new TUIElement();
        b.tabIndex = 0;
        b.role = "second";
        container.addChild(a);
        container.addChild(b);

        const testApp = TestApp.create(createBody(container), new Size(20, 5));

        expect(testApp.focusedElement).toBeNull();

        a.focus();
        expect(testApp.focusedElement).toBe(a);

        b.focus();
        expect(testApp.focusedElement).toBe(b);
    });

    it("Tab cycles focus between focusable elements", () => {
        const container = new ContainerElement();
        const a = new TUIElement();
        a.tabIndex = 0;
        a.id = "first";
        const b = new TUIElement();
        b.tabIndex = 0;
        b.id = "second";
        container.addChild(a);
        container.addChild(b);

        const testApp = TestApp.create(createBody(container), new Size(20, 5));
        a.focus();

        expect(testApp.focusedElement).toBe(a);
        testApp.sendKey("Tab");
        expect(testApp.focusedElement).toBe(b);
        testApp.sendKey("Tab");
        expect(testApp.focusedElement).toBe(a);
    });
});
