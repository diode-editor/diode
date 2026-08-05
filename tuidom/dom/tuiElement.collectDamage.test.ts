import { describe, expect, it, vi } from "vitest";

import { BoxConstraints, Offset, Point, Rect, Size } from "../common/geometryPromitives.ts";
import { DamageList } from "../rendering/damage.ts";
import { ScrollBarDecorator } from "../ui/scrollbar/scrollContainerElement.ts";
import type { ScrollViewportInfo } from "../ui/scrollbar/scrollableElement.ts";
import { ScrollableElement } from "../ui/scrollbar/scrollableElement.ts";

import type { RenderContext } from "./tuiElement.ts";
import { TUIElement } from "./tuiElement.ts";

function rect(x: number, y: number, w: number, h: number): Rect {
    return new Rect(new Point(x, y), new Size(w, h));
}

/** Контейнер с двумя панелями 5×2; позиция B настраивается. */
class TwoPanesElement extends TUIElement {
    public readonly paneA = new TUIElement();
    public readonly paneB = new TUIElement();
    public paneBPosition = new Point(10, 0);

    public constructor() {
        super();
        this.appendChild(this.paneA);
        this.appendChild(this.paneB);
    }

    public detachB(): void {
        this.removeChild(this.paneB);
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        const pane = BoxConstraints.tight(new Size(5, 2));
        if (!this.paneA.hidden) this.layoutChild(this.paneA, 0, 0, pane);
        if (!this.paneB.hidden) this.layoutChild(this.paneB, this.paneBPosition.x, this.paneBPosition.y, pane);
        return size;
    }
}

const SIZE = new Size(20, 10);

function createSettled(): TwoPanesElement {
    const root = new TwoPanesElement();
    root.setAsRoot();
    root.layout(BoxConstraints.tight(SIZE));
    // Первый обход «кадра»: всё новое — полный damage, учёт заполняется.
    root.collectDamage(new DamageList(), new Point(0, 0));
    return root;
}

function collect(root: TUIElement): readonly Rect[] {
    root.layout(BoxConstraints.tight(SIZE));
    const sink = new DamageList();
    root.collectDamage(sink, new Point(0, 0));
    return sink.snapshot();
}

describe("TUIElement.collectDamage", () => {
    it("первый обход повреждает корень целиком, устоявшееся дерево — ничего", () => {
        const root = new TwoPanesElement();
        root.setAsRoot();
        root.layout(BoxConstraints.tight(SIZE));
        const first = new DamageList();
        root.collectDamage(first, new Point(0, 0));
        expect(first.snapshot()[0]).toEqual(rect(0, 0, 20, 10));

        expect(collect(root)).toHaveLength(0);
    });

    it("markDirty листа повреждает только его rect; флаги и учёт снимаются", () => {
        const root = createSettled();
        root.paneA.markDirty();

        expect(collect(root)).toEqual([rect(0, 0, 5, 2)]);
        expect(collect(root)).toHaveLength(0); // повторный обход чист
    });

    it("переезд ребёнка при перераскладке повреждает old∪new его rect'а", () => {
        const root = createSettled();
        // Реалистичный сценарий: изменившийся сиблинг метит себя, контейнер
        // перекладывает детей — B переезжает без собственного markDirty.
        root.paneBPosition = new Point(12, 5);
        root.paneA.markDirty();

        const damage = collect(root);
        expect(damage).toContainEqual(rect(0, 0, 5, 2)); // paint-dirty A
        expect(damage).toContainEqual(rect(10, 0, 5, 2)); // старое место B
        expect(damage).toContainEqual(rect(12, 5, 5, 2)); // новое место B
        // Rect контейнера целиком НЕ поврежён — только точечные области.
        expect(damage).not.toContainEqual(rect(0, 0, 20, 10));
    });

    it("hidden: скрытие повреждает старое место, показ — новое", () => {
        const root = createSettled();
        root.paneB.hidden = true;
        expect(collect(root)).toContainEqual(rect(10, 0, 5, 2));

        root.paneB.hidden = false;
        expect(collect(root)).toContainEqual(rect(10, 0, 5, 2));
    });

    it("отцепление поддерева отдаёт его rect через takePendingDetachDamage на корне", () => {
        const root = createSettled();
        root.detachB();

        expect(root.takePendingDetachDamage()).toEqual([rect(10, 0, 5, 2)]);
        expect(root.takePendingDetachDamage()).toHaveLength(0); // дренаж одноразовый
    });

    it("markDirty контейнера повреждает его rect, но не спускается в чистых детей", () => {
        const root = createSettled();
        const spy = vi.spyOn(root.paneA, "collectDamage");
        root.markDirty();

        // Контейнер paint-dirty — его rect (накрывающий детей) в damage.
        expect(collect(root)).toEqual([rect(0, 0, 20, 10)]);
        // hasPaintDirtyDescendant не выставлялся — спуска в детей не было.
        expect(spy).not.toHaveBeenCalled();
    });
});

class FakeScrollable extends ScrollableElement {
    public override get contentHeight(): number {
        return 100;
    }

    public override get contentWidth(): number {
        return 10;
    }

    protected override renderViewport(_context: RenderContext, _viewport: ScrollViewportInfo): void {
        // Тесту не нужен вывод.
    }
}

describe("ScrollBarDecorator — атомарное поддерево damage", () => {
    it("скролл ребёнка повреждает весь rect декоратора (колонку бегунка тоже)", () => {
        const child = new FakeScrollable();
        const decorator = new ScrollBarDecorator(child);
        decorator.setAsRoot();
        decorator.layout(BoxConstraints.tight(new Size(10, 5)));
        decorator.collectDamage(new DamageList(), new Point(0, 0));

        child.scrollTo(0, 7);
        decorator.layout(BoxConstraints.tight(new Size(10, 5)));
        const sink = new DamageList();
        const spy = vi.spyOn(child, "collectDamage");
        decorator.collectDamage(sink, new Point(0, 0));

        expect(sink.snapshot()).toEqual([rect(0, 0, 10, 5)]);
        expect(spy).not.toHaveBeenCalled(); // атомарность: внутрь не заходим
    });
});
