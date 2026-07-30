import { describe, expect, it, vi } from "vitest";

import { BoxConstraints, Offset, Point, Size } from "../common/geometryPromitives.ts";

import { FocusManager } from "./events/focusManager.ts";
import { EventPhase, TUIEventBase } from "./events/tuiEventBase.ts";
import { TUIKeyboardEvent } from "./events/tuiKeyboardEvent.ts";
import { TUIElement } from "./tuiElement.ts";

describe("TUIElement coordinate system", () => {
    it("initializes with default coordinates", () => {
        const element = new TUIElement();
        expect(element.localPosition).toEqual(new Offset(0, 0));
        expect(element.globalPosition).toEqual(new Point(0, 0));
        expect(element.isLayoutDirty).toBe(true);
    });

    it("performLayout returns calculated size", () => {
        const element = new TUIElement();
        const constraints = BoxConstraints.tight(new Size(10, 5));
        const result = element.layout(constraints);

        expect(result).toEqual(new Size(10, 5));
    });

    it("performLayout marks element as clean", () => {
        const element = new TUIElement();
        expect(element.isLayoutDirty).toBe(true);

        const constraints = BoxConstraints.tight(new Size(10, 5));
        element.layout(constraints);

        expect(element.isLayoutDirty).toBe(false);
    });

    it("lazy size getter triggers layout when isDirty", () => {
        const element = new TUIElement();
        const spy = vi.spyOn(element, "layout");

        // First access should trigger layout
        const size = element.layoutSize;

        expect(spy).toHaveBeenCalled();
        expect(size).toEqual(new Size(80, 24)); // default
    });

    it("lazy size getter does not trigger layout when clean", () => {
        const element = new TUIElement();
        element.layout(BoxConstraints.tight(new Size(10, 5)));
        const spy = vi.spyOn(element, "layout");

        const size = element.layoutSize;

        expect(spy).not.toHaveBeenCalled();
        expect(size).toEqual(new Size(10, 5));
    });

    it("layout() records the constraints it was called with", () => {
        const element = new TUIElement();
        expect(element.lastLayoutConstraints).toBeNull();
        const constraints = BoxConstraints.tight(new Size(10, 5));
        element.layout(constraints);
        expect(element.lastLayoutConstraints).toBe(constraints);
    });

    it("layout() throws when performLayout violates the constraints", () => {
        class Violator extends TUIElement {
            protected override performLayout(): Size {
                return super.performLayout(BoxConstraints.tight(new Size(99, 1)));
            }
        }
        const element = new Violator();
        expect(() => element.layout(BoxConstraints.tight(new Size(10, 5)))).toThrow(/нарушив constraints/);
    });

    it("layout() throws when the returned size diverges from allocatedSize", () => {
        class Liar extends TUIElement {
            protected override performLayout(constraints: BoxConstraints): Size {
                // Дефолтный allocatedSize 80×24 → constrain даст (10, 6); возврат (10, 5)
                // удовлетворяет constraints, но расходится с записанным.
                super.performLayout(constraints);
                return new Size(constraints.minWidth, constraints.minHeight);
            }
        }
        const element = new Liar();
        expect(() => element.layout(new BoxConstraints(10, 10, 5, 6))).toThrow(/записал allocatedSize/);
    });

    it("markDirty sets isLayoutDirty flag", () => {
        const element = new TUIElement();
        element.layout(BoxConstraints.tight(new Size(10, 5)));
        expect(element.isLayoutDirty).toBe(false);

        element.markDirty();

        expect(element.isLayoutDirty).toBe(true);
    });

    it("markDirty propagates to parent", () => {
        const parent = new ContainerElement();
        const child = new TUIElement();
        parent.addChild(child);

        parent.layout(BoxConstraints.tight(new Size(10, 5)));
        expect(parent.isLayoutDirty).toBe(false);

        child.markDirty();

        expect(parent.isLayoutDirty).toBe(true);
    });

    it("markDirty propagates through multiple ancestors", () => {
        const grandparent = new ContainerElement();
        const parent = new ContainerElement();
        const child = new TUIElement();

        grandparent.addChild(parent);
        parent.addChild(child);

        grandparent.layout(BoxConstraints.tight(new Size(10, 5)));
        parent.layout(BoxConstraints.tight(new Size(10, 5)));

        expect(grandparent.isLayoutDirty).toBe(false);
        expect(parent.isLayoutDirty).toBe(false);

        child.markDirty();

        expect(parent.isLayoutDirty).toBe(true);
        expect(grandparent.isLayoutDirty).toBe(true);
    });

    it("setParent establishes parent reference", () => {
        const parent = new ContainerElement();
        const child = new TUIElement();

        parent.addChild(child);

        // Verify by checking dirty propagation works
        parent.layout(BoxConstraints.tight(new Size(10, 5)));
        child.markDirty();

        expect(parent.isLayoutDirty).toBe(true);
    });

    it("отцепление убирает ссылку на родителя", () => {
        const parent = new ContainerElement();
        const child = new TUIElement();

        parent.addChild(child);
        parent.detachChild(child);

        parent.layout(BoxConstraints.tight(new Size(10, 5)));
        child.markDirty();

        // Parent should remain clean since child has no parent
        expect(parent.isLayoutDirty).toBe(false);
    });

    it("localPosition reflects relative offset from parent", () => {
        const element = new TUIElement();
        const offset = new Offset(5, 10);
        element.localPosition = offset;

        expect(element.localPosition).toEqual(offset);
    });

    it("globalPosition выводится из цепочки родителей (parent.global + local)", () => {
        // Позиция производная: у standalone-элемента равна localPosition, у
        // ребёнка — сумме localPosition вверх по цепочке. Рассинхрон полей,
        // который раньше приходилось поддерживать руками, невозможен.
        const standalone = new TUIElement();
        standalone.localPosition = new Offset(15, 20);
        expect(standalone.globalPosition).toEqual(new Point(15, 20));

        const parent = new ContainerElement();
        parent.localPosition = new Offset(10, 5);
        const child = new TUIElement();
        child.localPosition = new Offset(3, 2);
        parent.addChild(child);
        expect(child.globalPosition).toEqual(new Point(13, 7));
    });

    it("child with null parent does not crash on markDirty", () => {
        const element = new TUIElement();

        expect(() => {
            element.markDirty();
        }).not.toThrow();
    });

    it("multiple markDirty calls are idempotent", () => {
        const parent1 = new ContainerElement();
        const parent2 = new ContainerElement();
        const child = new TUIElement();

        parent1.addChild(child);
        parent2.addChild(parent1);

        parent1.layout(BoxConstraints.tight(new Size(10, 5)));
        parent2.layout(BoxConstraints.tight(new Size(10, 5)));

        child.markDirty();
        child.markDirty();
        child.markDirty();

        // All should be dirty regardless of multiple calls
        expect(child.isLayoutDirty).toBe(true);
        expect(parent1.isLayoutDirty).toBe(true);
        expect(parent2.isLayoutDirty).toBe(true);
    });

    it("lazy getter with loose constraints uses default size", () => {
        const element = new TUIElement();
        const size = element.layoutSize; // Should not crash

        expect(size).toEqual(new Size(80, 24)); // default
        expect(element.isLayoutDirty).toBe(false);
    });
});

describe("TUIElement root reference propagation", () => {
    it("setParent propagates root from parent to child", () => {
        const parent = new ContainerElement();
        const child = new TUIElement();

        parent.setAsRoot();

        parent.addChild(child);

        expect(child.getRoot()).toBe(parent);
    });

    it("отцепление обнуляет производный root", () => {
        const parent = new ContainerElement();
        const child = new TUIElement();

        parent.setAsRoot();
        parent.addChild(child);
        expect(child.getRoot()).toBe(parent);

        parent.detachChild(child);
        expect(child.getRoot()).toBeNull();
    });

    it("nested children all get root reference from grandparent", () => {
        const root = new ContainerElement();
        const parent = new ContainerElement();
        const child = new TUIElement();

        root.setAsRoot();
        root.addChild(parent);
        parent.addChild(child);

        expect(root.getRoot()).toBe(root);
        expect(parent.getRoot()).toBe(root);
        expect(child.getRoot()).toBe(root);
    });

    it("multiple children of same parent all get same root", () => {
        const root = new ContainerElement();
        const child1 = new TUIElement();
        const child2 = new TUIElement();

        root.setAsRoot();
        root.addChild(child1);
        root.addChild(child2);

        expect(child1.getRoot()).toBe(root);
        expect(child2.getRoot()).toBe(root);
        expect(child1.getRoot()).toBe(child2.getRoot());
    });

    it("changing parent updates root reference", () => {
        const root1 = new ContainerElement();
        const root2 = new ContainerElement();
        const child = new TUIElement();

        root1.setAsRoot();
        root2.setAsRoot();

        root1.addChild(child);
        expect(child.getRoot()).toBe(root1);

        root2.addChild(child);
        expect(child.getRoot()).toBe(root2);
    });
});

// ─── Helper: container element with explicit children ───

class ContainerElement extends TUIElement {
    public addChild(child: TUIElement): void {
        this.appendChild(child);
    }

    public detachChild(child: TUIElement): void {
        this.removeChild(child);
    }
}

function buildTree(): { root: ContainerElement; parent: ContainerElement; child: TUIElement } {
    const root = new ContainerElement();
    root.setAsRoot();
    const parent = new ContainerElement();
    root.addChild(parent);
    const child = new TUIElement();
    parent.addChild(child);
    return { root, parent, child };
}

// ─── New event system tests ───

describe("TUIElement.getChildren", () => {
    it("returns empty array by default", () => {
        const el = new TUIElement();
        expect(el.getChildren()).toEqual([]);
    });

    it("ContainerElement returns added children", () => {
        const container = new ContainerElement();
        const child1 = new TUIElement();
        const child2 = new TUIElement();
        container.addChild(child1);
        container.addChild(child2);
        expect(container.getChildren()).toEqual([child1, child2]);
    });
});

describe("TUIElement.getAncestorPath", () => {
    it("returns single element for orphaned element", () => {
        const el = new TUIElement();
        expect(el.getAncestorPath()).toEqual([el]);
    });

    it("returns path from root to target", () => {
        const { root, parent, child } = buildTree();
        expect(child.getAncestorPath()).toEqual([root, parent, child]);
    });

    it("returns [root] for root element itself", () => {
        const { root } = buildTree();
        expect(root.getAncestorPath()).toEqual([root]);
    });
});

describe("TUIElement.getDepthFirstFocusableOrder", () => {
    it("returns empty when no elements are focusable", () => {
        const { root } = buildTree();
        expect(root.getDepthFirstFocusableOrder()).toEqual([]);
    });

    it("returns focusable elements in depth-first order", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        const a = new TUIElement();
        a.focusable = true;
        const b = new TUIElement();
        b.focusable = true;
        const c = new TUIElement();
        // c.focusable = false (default, not focusable)
        root.addChild(a);
        root.addChild(b);
        root.addChild(c);
        expect(root.getDepthFirstFocusableOrder()).toEqual([a, b]);
    });

    it("traverses nested containers depth-first", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        const containerA = new ContainerElement();
        root.addChild(containerA);
        const a1 = new TUIElement();
        a1.focusable = true;
        containerA.addChild(a1);
        const a2 = new TUIElement();
        a2.focusable = true;
        containerA.addChild(a2);

        const containerB = new ContainerElement();
        root.addChild(containerB);
        const b1 = new TUIElement();
        b1.focusable = true;
        containerB.addChild(b1);

        expect(root.getDepthFirstFocusableOrder()).toEqual([a1, a2, b1]);
    });
});

describe("TUIElement.id and role", () => {
    it("id defaults to undefined", () => {
        const el = new TUIElement();
        expect(el.id).toBeUndefined();
    });

    it("id can be set and read", () => {
        const el = new TUIElement();
        el.id = "main-editor";
        expect(el.id).toBe("main-editor");
    });

    it("role defaults to undefined", () => {
        const el = new TUIElement();
        expect(el.role).toBeUndefined();
    });

    it("role can be set and read", () => {
        const el = new TUIElement();
        el.role = "menubar";
        expect(el.role).toBe("menubar");
    });
});
