import { describe, expect, it } from "vitest";

import { BoxConstraints, Point, Size } from "../common/geometryPromitives.ts";

import { FocusManager } from "./events/focusManager.ts";
import { TUIElement } from "./tuiElement.ts";

/** Тестовый контейнер, открывающий protected-API владения детьми. */
class ContainerElement extends TUIElement {
    public add(child: TUIElement): void {
        this.appendChild(child);
    }

    public insert(index: number, child: TUIElement): void {
        this.insertChild(index, child);
    }

    public remove(child: TUIElement): void {
        this.removeChild(child);
    }

    public replace(oldChild: TUIElement, newChild: TUIElement): void {
        this.replaceChild(oldChild, newChild);
    }

    public setAll(children: readonly TUIElement[]): void {
        this.setChildren(children);
    }
}

describe("TUIElement — владение детьми", () => {
    it("appendChild прикрепляет: ребёнок в списке, parent выставлен", () => {
        const parent = new ContainerElement();
        const child = new TUIElement();
        parent.add(child);

        expect(parent.getChildren()).toEqual([child]);
        expect(child.getParent()).toBe(parent);
    });

    it("appendChild перевешивает ребёнка от прежнего родителя", () => {
        const a = new ContainerElement();
        const b = new ContainerElement();
        const child = new TUIElement();
        a.add(child);
        b.add(child);

        expect(a.getChildren()).toEqual([]);
        expect(b.getChildren()).toEqual([child]);
        expect(child.getParent()).toBe(b);
    });

    it("insertChild вставляет по индексу", () => {
        const parent = new ContainerElement();
        const first = new TUIElement();
        const second = new TUIElement();
        const between = new TUIElement();
        parent.add(first);
        parent.add(second);
        parent.insert(1, between);

        expect(parent.getChildren()).toEqual([first, between, second]);
    });

    it("элемент не может стать собственным ребёнком", () => {
        const parent = new ContainerElement();
        expect(() => {
            parent.add(parent);
        }).toThrow(/собственным ребёнком/);
    });

    it("removeChild отцепляет; чужой ребёнок — no-op", () => {
        const parent = new ContainerElement();
        const child = new TUIElement();
        parent.add(child);
        parent.remove(child);

        expect(parent.getChildren()).toEqual([]);
        expect(child.getParent()).toBeNull();

        expect(() => {
            parent.remove(new TUIElement());
        }).not.toThrow();
    });

    it("replaceChild сохраняет позицию (z-порядок слотов)", () => {
        const parent = new ContainerElement();
        const first = new TUIElement();
        const old = new TUIElement();
        const last = new TUIElement();
        parent.setAll([first, old, last]);

        const next = new TUIElement();
        parent.replace(old, next);

        expect(parent.getChildren()).toEqual([first, next, last]);
        expect(old.getParent()).toBeNull();
        expect(next.getParent()).toBe(parent);
    });

    it("replaceChild с тем же элементом — no-op", () => {
        const parent = new ContainerElement();
        const child = new TUIElement();
        parent.add(child);
        parent.replace(child, child);
        expect(parent.getChildren()).toEqual([child]);
    });

    it("replaceChild отсутствующего старого — просто append", () => {
        const parent = new ContainerElement();
        const child = new TUIElement();
        parent.replace(new TUIElement(), child);
        expect(parent.getChildren()).toEqual([child]);
    });

    it("replaceChild крадёт нового ребёнка у прежнего родителя", () => {
        const parent = new ContainerElement();
        const other = new ContainerElement();
        const old = new TUIElement();
        const next = new TUIElement();
        parent.add(old);
        other.add(next);

        parent.replace(old, next);

        expect(other.getChildren()).toEqual([]);
        expect(parent.getChildren()).toEqual([next]);
    });

    it("setChildren декларативно: лишние отцепляются, новые прикрепляются, порядок задан", () => {
        const parent = new ContainerElement();
        const a = new TUIElement();
        const b = new TUIElement();
        const c = new TUIElement();
        parent.setAll([a, b]);
        parent.setAll([c, a]);

        expect(parent.getChildren()).toEqual([c, a]);
        expect(b.getParent()).toBeNull();
        expect(c.getParent()).toBe(parent);
    });

    it("setChildren крадёт ребёнка у другого родителя", () => {
        const a = new ContainerElement();
        const b = new ContainerElement();
        const child = new TUIElement();
        a.add(child);
        b.setAll([child]);

        expect(a.getChildren()).toEqual([]);
        expect(child.getParent()).toBe(b);
    });

    it("setChildren бросает на дубликате", () => {
        const parent = new ContainerElement();
        const child = new TUIElement();
        expect(() => {
            parent.setAll([child, child]);
        }).toThrow(/дважды/);
    });

    it("отцепление гасит фокус, если он внутри поддерева", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        const fm = new FocusManager(root);
        root.focusManager = fm;

        const branch = new ContainerElement();
        const leaf = new TUIElement();
        leaf.focusable = true;
        root.add(branch);
        branch.add(leaf);
        fm.setFocus(leaf);
        expect(fm.activeElement).toBe(leaf);

        root.remove(branch);
        expect(fm.activeElement).toBeNull();
    });

    it("отцепление НЕ гасит фокус, если он вне поддерева", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        const fm = new FocusManager(root);
        root.focusManager = fm;

        const branch = new ContainerElement();
        const outside = new TUIElement();
        outside.focusable = true;
        root.add(branch);
        root.add(outside);
        fm.setFocus(outside);

        root.remove(branch);
        expect(fm.activeElement).toBe(outside);
    });
});

describe("TUIElement — hidden (структура ≠ видимость)", () => {
    it("скрытый элемент остаётся в дереве: parent и root на месте", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        const child = new TUIElement();
        root.add(child);

        child.hidden = true;

        expect(root.getChildren()).toContain(child);
        expect(child.getParent()).toBe(root);
        expect(child.getRoot()).toBe(root);
    });

    it("повторная установка того же значения — no-op (без markDirty)", () => {
        const child = new TUIElement();
        child.layout(BoxConstraints.tight(new Size(4, 2)));
        expect(child.isLayoutDirty).toBe(false);
        child.hidden = false; // уже false
        expect(child.isLayoutDirty).toBe(false);
        child.hidden = true; // смена — markDirty
        expect(child.isLayoutDirty).toBe(true);
    });

    it("Tab-обход пропускает скрытые поддеревья целиком", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        const visible = new TUIElement();
        visible.focusable = true;
        const branch = new ContainerElement();
        const insideHidden = new TUIElement();
        insideHidden.focusable = true;
        root.add(visible);
        root.add(branch);
        branch.add(insideHidden);

        expect(root.getDepthFirstFocusableOrder()).toEqual([visible, insideHidden]);
        branch.hidden = true;
        expect(root.getDepthFirstFocusableOrder()).toEqual([visible]);
    });

    it("hit-test не попадает в скрытое; клик проваливается к элементу ниже", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        root.layout(BoxConstraints.tight(new Size(20, 10)));
        const below = new TUIElement();
        const above = new TUIElement();
        root.add(below);
        root.add(above); // последний — поверх
        below.layout(BoxConstraints.tight(new Size(20, 10)));
        above.layout(BoxConstraints.tight(new Size(20, 10)));

        expect(root.elementFromPoint(new Point(3, 3))).toBe(above);
        above.hidden = true;
        expect(root.elementFromPoint(new Point(3, 3))).toBe(below);
    });

    it("стили доходят до скрытых поддеревьев (готовы к показу без пересчёта)", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        const branch = new ContainerElement();
        const leaf = new TUIElement();
        root.add(branch);
        branch.add(leaf);
        branch.hidden = true;
        leaf.style = { fg: 123 };

        root.performStyleResolution(root.resolvedStyle);

        expect(leaf.resolvedStyle.fg).toBe(123);
    });
});
