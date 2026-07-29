import { describe, expect, it } from "vitest";

import { BoxConstraints, Offset, Size } from "../common/geometryPromitives.ts";

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

describe("validateTree — layout-контракт", () => {
    it("проходит для дерева, разложенного по контракту", () => {
        const root = makeRootedContainer();
        const child = new TUIElement();
        root.add(child);
        root.layout(BoxConstraints.tight(new Size(80, 24)));
        child.layout(BoxConstraints.loose(new Size(80, 24)));

        expect(validateTree(root)).toEqual([]);
    });

    it("ловит размер, разошедшийся с constraints последнего layout", () => {
        const root = makeRootedContainer();
        const child = new TUIElement();
        child.id = "broken";
        root.add(child);
        child.layout(BoxConstraints.tight(new Size(10, 5)));
        // Мутация после layout: новый layout с другими constraints, затем
        // подмена записанных constraints невозможна — эмулируем через второй
        // layout и «протухшую» запись: ломаем running state руками.
        (child as unknown as { lastConstraintsValue: BoxConstraints }).lastConstraintsValue = BoxConstraints.tight(
            new Size(3, 3),
        );

        const violations = validateTree(root);
        expect(violations.some((v) => v.includes("broken") && v.includes("нарушает layout-контракт"))).toBe(true);
    });

    it("пропускает узлы с isLayoutDirty (офскрин-строки виртуализации)", () => {
        const root = makeRootedContainer();
        const stale = new TUIElement();
        root.add(stale);
        stale.layout(BoxConstraints.tight(new Size(10, 5)));
        (stale as unknown as { lastConstraintsValue: BoxConstraints }).lastConstraintsValue = BoxConstraints.tight(
            new Size(3, 3),
        );
        stale.isLayoutDirty = true; // помечен на переclamp — не проверяем

        expect(validateTree(root)).toEqual([]);
    });

    it("пропускает скрытые поддеревья целиком", () => {
        const root = makeRootedContainer();
        const panel = new ContainerElement();
        const inner = new TUIElement();
        root.add(panel);
        panel.add(inner);
        // Ребёнок скрытой панели «чист», но с нарушенной геометрией прошлых кадров.
        inner.layout(BoxConstraints.tight(new Size(10, 5)));
        (inner as unknown as { lastConstraintsValue: BoxConstraints }).lastConstraintsValue = BoxConstraints.tight(
            new Size(3, 3),
        );
        panel.hidden = true;
        panel.isLayoutDirty = false;
        inner.isLayoutDirty = false;

        expect(validateTree(root)).toEqual([]);
    });

    it("пропускает ни разу не разложенные узлы", () => {
        const root = makeRootedContainer();
        const fresh = new TUIElement();
        root.add(fresh);
        fresh.isLayoutDirty = false; // чист, но layout() не вызывался

        expect(validateTree(root)).toEqual([]);
    });
});

describe("validateTree — инвариант вложенности", () => {
    it("проходит, когда ребёнок внутри родителя (включая совпадение границ)", () => {
        const root = makeRootedContainer();
        const child = new TUIElement();
        root.add(child);
        root.layout(BoxConstraints.tight(new Size(80, 24)));
        child.layout(BoxConstraints.tight(new Size(80, 24))); // ровно в границы

        expect(validateTree(root)).toEqual([]);
    });

    it("ловит ребёнка, вылезающего за родителя размером", () => {
        const root = makeRootedContainer();
        const child = new TUIElement();
        child.id = "spill";
        root.add(child);
        root.layout(BoxConstraints.tight(new Size(20, 5)));
        child.layout(BoxConstraints.tight(new Size(80, 24))); // шире и выше родителя

        const violations = validateTree(root);
        expect(violations.some((v) => v.includes("spill") && v.includes("вылезает за родителя"))).toBe(true);
    });

    it("ловит ребёнка, вылезающего позицией при подходящем размере", () => {
        const root = makeRootedContainer();
        const child = new TUIElement();
        child.id = "shifted";
        root.add(child);
        root.layout(BoxConstraints.tight(new Size(20, 5)));
        child.layout(BoxConstraints.tight(new Size(10, 3)));
        child.localPosition = new Offset(15, 4); // 15+10 > 20, 4+3 > 5

        const violations = validateTree(root);
        expect(violations.some((v) => v.includes("shifted") && v.includes("вылезает за родителя"))).toBe(true);
    });

    it("пропускает пару, где dirty сам родитель (его геометрия stale)", () => {
        const root = makeRootedContainer();
        const panel = new ContainerElement();
        const child = new TUIElement();
        root.add(panel);
        panel.add(child);
        root.layout(BoxConstraints.tight(new Size(80, 24)));
        panel.layout(BoxConstraints.tight(new Size(20, 5)));
        child.layout(BoxConstraints.tight(new Size(80, 24))); // вылезает
        panel.isLayoutDirty = true; // но родитель ждёт переклада — пара не проверяется

        expect(validateTree(root)).toEqual([]);
    });

    it("пропускает пару, где родитель чист, но ни разу не раскладывался", () => {
        const root = makeRootedContainer();
        const child = new TUIElement();
        root.add(child);
        root.isLayoutDirty = false; // чист, но layout() не вызывался
        child.layout(BoxConstraints.tight(new Size(80, 24)));

        expect(validateTree(root)).toEqual([]);
    });

    it("нулевой ребёнок на краю родителя — не нарушение", () => {
        const root = makeRootedContainer();
        const child = new TUIElement();
        root.add(child);
        root.layout(BoxConstraints.tight(new Size(20, 5)));
        child.layout(BoxConstraints.tight(new Size(0, 0)));
        child.localPosition = new Offset(20, 5); // ровно на границе, пустой

        expect(validateTree(root)).toEqual([]);
    });
});
