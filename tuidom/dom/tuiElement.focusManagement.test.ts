import { describe, expect, it } from "vitest";

import { FocusManager } from "./events/focusManager.ts";
import { TUIElement } from "./tuiElement.ts";

class ContainerElement extends TUIElement {
    public addChild(child: TUIElement): void {
        this.appendChild(child);
    }
}

describe("TUIElement focus convenience", () => {
    it("isFocused returns false when no focusManager", () => {
        const el = new TUIElement();
        expect(el.isFocused).toBe(false);
    });

    it("isFocused returns true when element is activeElement", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        const fm = new FocusManager(root);
        root.focusManager = fm;

        const child = new TUIElement();
        child.focusable = true;
        root.addChild(child);
        fm.setFocus(child);

        expect(child.isFocused).toBe(true);
    });

    it("focus() sets this as active element", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        const fm = new FocusManager(root);
        root.focusManager = fm;

        const child = new TUIElement();
        child.focusable = true;
        root.addChild(child);

        child.focus();
        expect(fm.activeElement).toBe(child);
    });

    it("blur() removes this from active element", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        const fm = new FocusManager(root);
        root.focusManager = fm;

        const child = new TUIElement();
        child.focusable = true;
        root.addChild(child);

        child.focus();
        expect(fm.activeElement).toBe(child);

        child.blur();
        expect(fm.activeElement).toBeNull();
    });

    it("blur() is no-op if element is not focused", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        const fm = new FocusManager(root);
        root.focusManager = fm;

        const child1 = new TUIElement();
        child1.focusable = true;
        root.addChild(child1);
        const child2 = new TUIElement();
        child2.focusable = true;
        root.addChild(child2);

        child1.focus();
        child2.blur(); // child2 is not focused, should not affect anything
        expect(fm.activeElement).toBe(child1);
    });

    it("blur() is a no-op when the element has no root", () => {
        const el = new TUIElement();
        // No root → no focus manager; blur() must short-circuit without throwing.
        expect(() => {
            el.blur();
        }).not.toThrow();
    });
});
