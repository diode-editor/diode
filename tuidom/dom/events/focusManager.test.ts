import { describe, expect, it, vi } from "vitest";

import { TUIElement } from "../tuiElement.ts";

import { FocusManager } from "./focusManager.ts";
import type { TUIEventBase } from "./tuiEventBase.ts";
import { TUIFocusEvent } from "./tuiFocusEvent.ts";

class ContainerElement extends TUIElement {
    public addChild(child: TUIElement): void {
        this.appendChild(child);
    }
}

function buildFocusableTree(): {
    root: ContainerElement;
    a: TUIElement;
    b: TUIElement;
    c: TUIElement;
    fm: FocusManager;
} {
    const root = new ContainerElement();
    root.setAsRoot();
    const fm = new FocusManager(root);
    root.focusManager = fm;

    const a = new TUIElement();
    a.tabIndex = 0;
    root.addChild(a);

    const b = new TUIElement();
    b.tabIndex = 0;
    root.addChild(b);

    const c = new TUIElement();
    c.tabIndex = 0;
    root.addChild(c);

    return { root, a, b, c, fm };
}

describe("FocusManager", () => {
    describe("setFocus", () => {
        it("sets activeElement", () => {
            const { a, fm } = buildFocusableTree();
            fm.setFocus(a);
            expect(fm.activeElement).toBe(a);
        });

        it("is no-op when setting same element", () => {
            const { a, fm } = buildFocusableTree();
            fm.setFocus(a);

            const focusHandler = vi.fn();
            a.addEventListener("focus", focusHandler);

            fm.setFocus(a);
            expect(focusHandler).not.toHaveBeenCalled();
        });

        it("dispatches blur on old element when changing focus", () => {
            const { a, b, fm } = buildFocusableTree();

            fm.setFocus(a);

            const blurHandler = vi.fn();
            a.addEventListener("blur", blurHandler);

            fm.setFocus(b);

            expect(blurHandler).toHaveBeenCalledOnce();
            const event = blurHandler.mock.calls[0][0] as TUIFocusEvent;
            expect(event.type).toBe("blur");
            expect(event.relatedTarget).toBe(b);
        });

        it("dispatches focus on new element", () => {
            const { a, b, fm } = buildFocusableTree();

            fm.setFocus(a);

            const focusHandler = vi.fn();
            b.addEventListener("focus", focusHandler);

            fm.setFocus(b);

            expect(focusHandler).toHaveBeenCalledOnce();
            const event = focusHandler.mock.calls[0][0] as TUIFocusEvent;
            expect(event.type).toBe("focus");
            expect(event.relatedTarget).toBe(a);
        });

        it("dispatches blur before setting new activeElement", () => {
            const { a, b, fm } = buildFocusableTree();
            fm.setFocus(a);

            let activeOnBlur: TUIElement | null = null;
            a.addEventListener("blur", () => {
                activeOnBlur = fm.activeElement;
            });

            fm.setFocus(b);
            // During blur dispatch, activeElement should already be null
            expect(activeOnBlur).toBeNull();
        });

        it("setFocus(null) dispatches blur and clears activeElement", () => {
            const { a, fm } = buildFocusableTree();
            fm.setFocus(a);

            const blurHandler = vi.fn();
            a.addEventListener("blur", blurHandler);

            fm.setFocus(null);

            expect(fm.activeElement).toBeNull();
            expect(blurHandler).toHaveBeenCalledOnce();
            const event = blurHandler.mock.calls[0][0] as TUIFocusEvent;
            expect(event.relatedTarget).toBeNull();
        });

        it("focus event propagates through ancestor chain", () => {
            const root = new ContainerElement();
            root.setAsRoot();
            const fm = new FocusManager(root);
            root.focusManager = fm;

            const container = new ContainerElement();
            root.addChild(container);
            const child = new TUIElement();
            child.tabIndex = 0;
            container.addChild(child);

            const rootHandler = vi.fn();
            root.addEventListener("focus", rootHandler);
            const containerHandler = vi.fn();
            container.addEventListener("focus", containerHandler);

            fm.setFocus(child);

            expect(containerHandler).toHaveBeenCalledOnce();
            expect(rootHandler).toHaveBeenCalledOnce();
        });
    });

    describe("cycleFocus", () => {
        it("cycles forward through focusable elements", () => {
            const { a, b, c, fm } = buildFocusableTree();

            fm.cycleFocus("forward");
            expect(fm.activeElement).toBe(a);

            fm.cycleFocus("forward");
            expect(fm.activeElement).toBe(b);

            fm.cycleFocus("forward");
            expect(fm.activeElement).toBe(c);
        });

        it("wraps around when reaching the end", () => {
            const { a, c, fm } = buildFocusableTree();
            fm.setFocus(c);

            fm.cycleFocus("forward");
            expect(fm.activeElement).toBe(a);
        });

        it("cycles backward through focusable elements", () => {
            const { a, b, c, fm } = buildFocusableTree();
            fm.setFocus(c);

            fm.cycleFocus("backward");
            expect(fm.activeElement).toBe(b);

            fm.cycleFocus("backward");
            expect(fm.activeElement).toBe(a);
        });

        it("wraps around backward to last element", () => {
            const { a, c, fm } = buildFocusableTree();
            fm.setFocus(a);

            fm.cycleFocus("backward");
            expect(fm.activeElement).toBe(c);
        });

        it("starts at first element when nothing focused (forward)", () => {
            const { a, fm } = buildFocusableTree();
            expect(fm.activeElement).toBeNull();

            fm.cycleFocus("forward");
            expect(fm.activeElement).toBe(a);
        });

        it("starts at last element when nothing focused (backward)", () => {
            const { c, fm } = buildFocusableTree();
            expect(fm.activeElement).toBeNull();

            fm.cycleFocus("backward");
            expect(fm.activeElement).toBe(c);
        });

        it("skips elements with tabIndex = -1", () => {
            const root = new ContainerElement();
            root.setAsRoot();
            const fm = new FocusManager(root);
            root.focusManager = fm;

            const a = new TUIElement();
            a.tabIndex = 0;
            root.addChild(a);
            const skip = new TUIElement();
            // skip.tabIndex = -1 (default)
            root.addChild(skip);
            const b = new TUIElement();
            b.tabIndex = 0;
            root.addChild(b);

            fm.setFocus(a);
            fm.cycleFocus("forward");
            expect(fm.activeElement).toBe(b);
        });

        it("does nothing when no focusable elements", () => {
            const root = new ContainerElement();
            root.setAsRoot();
            const fm = new FocusManager(root);
            root.focusManager = fm;

            root.addChild(new TUIElement()); // tabIndex = -1

            fm.cycleFocus("forward");
            expect(fm.activeElement).toBeNull();
        });

        it("dispatches blur/focus events during cycling", () => {
            const { a, b, fm } = buildFocusableTree();
            fm.setFocus(a);

            const blurHandler = vi.fn();
            a.addEventListener("blur", blurHandler);
            const focusHandler = vi.fn();
            b.addEventListener("focus", focusHandler);

            fm.cycleFocus("forward");

            expect(blurHandler).toHaveBeenCalledOnce();
            expect(focusHandler).toHaveBeenCalledOnce();
        });
    });

    describe("focus scope (modal trapping)", () => {
        function buildScopedTree(): {
            root: ContainerElement;
            outside: TUIElement;
            scope: ContainerElement;
            m1: TUIElement;
            m2: TUIElement;
            fm: FocusManager;
        } {
            const root = new ContainerElement();
            root.setAsRoot();
            const fm = new FocusManager(root);
            root.focusManager = fm;

            const outside = new TUIElement();
            outside.tabIndex = 0;
            root.addChild(outside);

            const scope = new ContainerElement(); // tabIndex -1 → container only, not focusable itself
            root.addChild(scope);

            const m1 = new TUIElement();
            m1.tabIndex = 0;
            scope.addChild(m1);

            const m2 = new TUIElement();
            m2.tabIndex = 0;
            scope.addChild(m2);

            return { root, outside, scope, m1, m2, fm };
        }

        it("limits cycleFocus to the pushed scope subtree", () => {
            const { scope, m1, m2, fm } = buildScopedTree();
            fm.pushFocusScope(scope);

            fm.cycleFocus("forward");
            expect(fm.activeElement).toBe(m1);

            fm.cycleFocus("forward");
            expect(fm.activeElement).toBe(m2);

            // Wraps inside the scope — never lands on the outside element.
            fm.cycleFocus("forward");
            expect(fm.activeElement).toBe(m1);
        });

        it("restores full-tree cycling after the scope is popped", () => {
            const { outside, scope, m1, fm } = buildScopedTree();
            fm.pushFocusScope(scope);
            fm.cycleFocus("forward");
            expect(fm.activeElement).toBe(m1);

            fm.popFocusScope(scope);

            // Back to the whole tree: outside is the first focusable.
            fm.setFocus(null);
            fm.cycleFocus("forward");
            expect(fm.activeElement).toBe(outside);
        });

        it("ignores popFocusScope for an element that was never pushed", () => {
            const { outside, scope, fm } = buildScopedTree();
            const neverPushed = new TUIElement();

            fm.pushFocusScope(scope);
            // lastIndexOf returns -1 → the splice branch is skipped, stack unchanged.
            fm.popFocusScope(neverPushed);

            // The real scope is still active: cycling stays trapped inside it.
            fm.cycleFocus("forward");
            expect(fm.activeElement).not.toBe(outside);
        });

        it("keeps the stack consistent when scopes are popped out of order", () => {
            const { outside, scope, fm } = buildScopedTree();
            const inner = new ContainerElement();
            scope.addChild(inner);
            const innerFocusable = new TUIElement();
            innerFocusable.tabIndex = 0;
            inner.addChild(innerFocusable);

            fm.pushFocusScope(scope);
            fm.pushFocusScope(inner);

            // Pop the outer scope first (non-LIFO); the top-of-stack inner scope still applies.
            fm.popFocusScope(scope);
            fm.cycleFocus("forward");
            expect(fm.activeElement).toBe(innerFocusable);

            // Popping the inner scope leaves no scopes → cycling spans the whole tree again.
            fm.popFocusScope(inner);
            fm.setFocus(null);
            fm.cycleFocus("forward");
            expect(fm.activeElement).toBe(outside);
        });
    });
});
