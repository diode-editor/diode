import { describe, expect, it } from "vitest";

import { TUIElement } from "./tuiElement.ts";
import { assertValidTree, validateTree } from "./validateTree.ts";

/**
 * Контейнер, УМЕЮЩИЙ ломать инварианты: наивный ручной список детей, как у
 * контейнеров до рефакторинга владения. validateTree тестируется именно на
 * сломанных состояниях, которые штатным API больше не собрать.
 */
class ContainerElement extends TUIElement {
    private readonly kids: TUIElement[] = [];

    public add(child: TUIElement, options?: { setParent?: boolean }): void {
        if (options?.setParent !== false) {
            this.appendChild(child);
        } else {
            this.kids.push(child); // сирота: в списке, но без parent
        }
    }

    public override getChildren(): readonly TUIElement[] {
        return [...super.getChildren(), ...this.kids];
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

    it("модель бага #204 больше не нарушение: производный root не протухает", () => {
        // Раньше: ребёнок, прикреплённый к неукоренённому контейнеру и скрытый
        // из getChildren() в момент укоренения, навсегда оставался с root=null.
        // Теперь getRoot() выводится из живой цепочки родителей — состояние
        // валидно без всяких перецеплений.
        const container = new ContainerElement();
        const child = new TUIElement();
        child.id = "stale";
        container.add(child); // контейнер ещё не укоренён

        const root = makeRootedContainer();
        // Ребёнок скрыт из getChildren() в момент укоренения (вкладка неактивна).
        const childrenSpy = container.getChildren.bind(container);
        let hideChildren = true;
        container.getChildren = () => (hideChildren ? [] : childrenSpy());
        root.add(container);
        hideChildren = false; // «вкладку активировали»

        expect(child.getRoot()).toBe(root);
        expect(validateTree(root)).toEqual([]);
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
        b.add(shared, { setParent: false }); // второй контейнер отдаёт тот же элемент

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
        root.add(child, { setParent: false }); // в root.getChildren() — сиротой
        stranger.add(child); // а parent теперь указывает на чужой контейнер

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
