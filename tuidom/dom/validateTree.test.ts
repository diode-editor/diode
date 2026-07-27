import { describe, expect, it } from "vitest";

import { TUIElement } from "./tuiElement.ts";
import { assertValidTree, validateTree } from "./validateTree.ts";

/** Контейнер с ручным списком детей — как настоящие контейнеры tuidom. */
class ContainerElement extends TUIElement {
    private readonly children: TUIElement[] = [];

    public add(child: TUIElement, options?: { setParent?: boolean }): void {
        this.children.push(child);
        if (options?.setParent !== false) {
            child.setParent(this);
        }
    }

    public override getChildren(): readonly TUIElement[] {
        return this.children;
    }
}

function makeRootedContainer(): ContainerElement {
    const root = new ContainerElement();
    root.setAsRoot();
    return root;
}

describe("validateTree", () => {
    it("возвращает пусто для корректного дерева", () => {
        const root = makeRootedContainer();
        const middle = new ContainerElement();
        root.add(middle);
        middle.add(new TUIElement());

        expect(validateTree(root)).toEqual([]);
        expect(() => {
            assertValidTree(root);
        }).not.toThrow();
    });

    it("ловит забытый setParent (ребёнок в getChildren, но parent не выставлен)", () => {
        const root = makeRootedContainer();
        const orphan = new TUIElement();
        orphan.id = "orphan";
        root.add(orphan, { setParent: false });

        const violations = validateTree(root);
        expect(violations.some((v) => v.includes("orphan") && v.includes("getParent"))).toBe(true);
    });

    it("ловит неукоренённое поддерево — модель бага #204", () => {
        const container = new ContainerElement();
        const child = new TUIElement();
        child.id = "stale";
        container.add(child); // container не укоренён → child.root = null

        const root = makeRootedContainer();
        // Прячем ребёнка от пропагации: родитель укореняется, но getChildren в
        // этот момент «не отдаёт» ребёнка (вкладка неактивна).
        const childrenSpy = container.getChildren.bind(container);
        let hideChildren = true;
        container.getChildren = () => (hideChildren ? [] : childrenSpy());
        root.add(container);
        hideChildren = false; // «вкладку активировали» — ребёнок снова виден

        const violations = validateTree(root);
        expect(violations.some((v) => v.includes("stale") && v.includes("не укоренён"))).toBe(true);
    });

    it("ловит двойное прикрепление одного элемента", () => {
        const root = makeRootedContainer();
        const shared = new TUIElement();
        shared.id = "shared";
        const a = new ContainerElement();
        const b = new ContainerElement();
        root.add(a);
        root.add(b);
        a.add(shared);
        b.add(shared);

        const violations = validateTree(root);
        expect(violations.some((v) => v.includes("shared") && v.includes("дважды"))).toBe(true);
    });

    it("ловит корень, не считающий себя корнем", () => {
        const notRoot = new ContainerElement();
        const violations = validateTree(notRoot);
        expect(violations.some((v) => v.includes("не считает себя корнем"))).toBe(true);
    });

    it("ловит устаревшую ссылку parent на другой контейнер", () => {
        const root = makeRootedContainer();
        const stranger = new ContainerElement();
        stranger.id = "stranger";
        const child = new TUIElement();
        child.id = "moved";
        root.add(child, { setParent: false });
        child.setParent(stranger); // ребёнок в root.getChildren(), а parent — чужой

        const violations = validateTree(root);
        expect(violations.some((v) => v.includes("moved") && v.includes("stranger"))).toBe(true);
    });

    it("описывает элемент в нарушении через id и role", () => {
        const root = makeRootedContainer();
        const orphan = new TUIElement();
        orphan.id = "orphan";
        orphan.role = "button";
        root.add(orphan, { setParent: false });

        const violations = validateTree(root);
        expect(violations[0]).toContain("TUIElement#orphan[role=button]");
    });

    it("assertValidTree бросает с перечнем нарушений", () => {
        const root = makeRootedContainer();
        const orphan = new TUIElement();
        root.add(orphan, { setParent: false });

        expect(() => {
            assertValidTree(root);
        }).toThrow(/нарушает инварианты/);
    });
});
