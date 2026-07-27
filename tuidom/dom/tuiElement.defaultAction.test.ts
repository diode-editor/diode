import { describe, expect, it, vi } from "vitest";

import { TUIEventBase } from "./events/tuiEventBase.ts";
import { TUIKeyboardEvent } from "./events/tuiKeyboardEvent.ts";
import { TUIElement } from "./tuiElement.ts";

class ContainerElement extends TUIElement {
    public addChild(child: TUIElement): void {
        this.appendChild(child);
    }
}

class ElementWithDefaultAction extends TUIElement {
    public defaultActionSpy = vi.fn<(event: TUIEventBase) => void>();

    protected override performDefaultAction(event: TUIEventBase): void {
        this.defaultActionSpy(event);
    }
}

function buildTree(): {
    root: ContainerElement;
    parent: ContainerElement;
    child: ElementWithDefaultAction;
} {
    const root = new ContainerElement();
    root.setAsRoot();
    const parent = new ContainerElement();
    root.addChild(parent);
    const child = new ElementWithDefaultAction();
    parent.addChild(child);
    return { root, parent, child };
}

describe("TUIElement performDefaultAction", () => {
    it("calls performDefaultAction after all propagation phases", () => {
        const { child } = buildTree();
        const order: string[] = [];

        child.defaultActionSpy.mockImplementation(() => order.push("defaultAction"));
        child.addEventListener("keydown", () => order.push("listener"));

        child.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));

        expect(order).toEqual(["listener", "defaultAction"]);
    });

    it("does not call performDefaultAction when preventDefault is called by target listener", () => {
        const { child } = buildTree();

        child.addEventListener("keydown", (e) => {
            e.preventDefault();
        });

        child.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));

        expect(child.defaultActionSpy).not.toHaveBeenCalled();
    });

    it("does not call performDefaultAction when preventDefault is called by capture listener on ancestor", () => {
        const { root, child } = buildTree();

        root.addEventListener(
            "keydown",
            (e) => {
                e.preventDefault();
            },
            { capture: true },
        );

        child.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));

        expect(child.defaultActionSpy).not.toHaveBeenCalled();
    });

    it("does not call performDefaultAction when preventDefault is called by bubble listener on ancestor", () => {
        const { parent, child } = buildTree();

        parent.addEventListener("keydown", (e) => {
            e.preventDefault();
        });

        child.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));

        expect(child.defaultActionSpy).not.toHaveBeenCalled();
    });

    it("calls performDefaultAction even when stopPropagation is called (without preventDefault)", () => {
        const { child } = buildTree();

        child.addEventListener("keydown", (e) => {
            e.stopPropagation();
        });

        child.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));

        expect(child.defaultActionSpy).toHaveBeenCalledOnce();
    });

    it("does not call performDefaultAction when both stopPropagation and preventDefault are called", () => {
        const { child } = buildTree();

        child.addEventListener("keydown", (e) => {
            e.stopPropagation();
            e.preventDefault();
        });

        child.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));

        expect(child.defaultActionSpy).not.toHaveBeenCalled();
    });

    it("calls performDefaultAction on target element, not on ancestors", () => {
        const { parent, child } = buildTree();

        const parentDefaultSpy = vi.fn();
        // Override on parent via a subclass trick — parent is ContainerElement, no default action
        // Verify that parent's performDefaultAction is NOT called
        Object.defineProperty(parent, "performDefaultAction", { value: parentDefaultSpy });

        child.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "a" }));

        expect(child.defaultActionSpy).toHaveBeenCalledOnce();
        expect(parentDefaultSpy).not.toHaveBeenCalled();
    });

    it("dispatchEvent returns false when performDefaultAction calls preventDefault on the event", () => {
        const { child } = buildTree();

        child.defaultActionSpy.mockImplementation((e) => {
            e.preventDefault();
        });

        const result = child.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));

        expect(result).toBe(false);
    });

    it("dispatchEvent returns true when performDefaultAction does not call preventDefault", () => {
        const { child } = buildTree();

        const result = child.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));

        expect(result).toBe(true);
        expect(child.defaultActionSpy).toHaveBeenCalledOnce();
    });

    it("performDefaultAction receives the correct event object", () => {
        const { child } = buildTree();

        const event = new TUIKeyboardEvent("keydown", { key: "x", ctrlKey: true });
        child.dispatchEvent(event);

        expect(child.defaultActionSpy).toHaveBeenCalledWith(event);
    });

    it("element without performDefaultAction override works as before (noop)", () => {
        const element = new TUIElement();
        element.setAsRoot();

        const result = element.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "a" }));

        expect(result).toBe(true);
    });
});
