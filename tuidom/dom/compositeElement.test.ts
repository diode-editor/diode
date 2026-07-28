import { describe, expect, it } from "vitest";

import { BoxConstraints, Offset, Point, Size } from "../common/geometryPromitives.ts";
import { TerminalScreen } from "../rendering/terminalScreen.ts";

import { CompositeElement } from "./compositeElement.ts";
import type { JsxNode } from "./jsx/jsx-runtime.ts";
import type { ComponentType } from "./jsx/jsx-runtime.ts";
import { jsx } from "./jsx/jsx-runtime.ts";
import { RenderContext, TUIElement } from "./tuiElement.ts";

// ─── Test helpers ───

class FakeLeaf extends TUIElement {
    public text: string;
    public rendered = false;

    public constructor(text: string) {
        super();
        this.text = text;
    }

    public override getMinIntrinsicWidth(_height: number): number {
        return this.text.length;
    }

    public override getMaxIntrinsicWidth(_height: number): number {
        return this.text.length;
    }

    public override getMinIntrinsicHeight(_width: number): number {
        return 1;
    }

    public override getMaxIntrinsicHeight(_width: number): number {
        return 1;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const natural = new Size(this.text.length, 1);
        return super.performLayout(BoxConstraints.tight(constraints.constrain(natural)));
    }

    public override render(_context: RenderContext): void {
        this.rendered = true;
    }
}

const LeafComponent: ComponentType<{ text: string }> = (props: { text: string }): FakeLeaf => {
    return new FakeLeaf(props.text);
};

LeafComponent.update = (el: TUIElement, props: { text: string }): void => {
    (el as FakeLeaf).text = props.text;
};

class TestComposite extends CompositeElement {
    public text = "hello";

    protected override describe(): JsxNode {
        return jsx(LeafComponent, { text: this.text });
    }
}

// ─── Tests ───

describe("CompositeElement", () => {
    describe("rebuild", () => {
        it("creates rootChild on first rebuild", () => {
            const comp = new TestComposite();
            comp.rebuild();

            expect(comp.getRootChild()).toBeInstanceOf(FakeLeaf);
            expect((comp.getRootChild() as FakeLeaf).text).toBe("hello");
        });

        it("sets parent on rootChild", () => {
            const comp = new TestComposite();
            comp.rebuild();

            expect(comp.getRootChild()!.getParent()).toBe(comp);
        });

        it("reuses rootChild on subsequent rebuilds", () => {
            const comp = new TestComposite();
            comp.rebuild();
            const first = comp.getRootChild();

            comp.text = "world";
            comp.rebuild();

            expect(comp.getRootChild()).toBe(first);
            expect((comp.getRootChild() as FakeLeaf).text).toBe("world");
        });
    });

    describe("intrinsic size delegation", () => {
        it("delegates getMinIntrinsicWidth to rootChild", () => {
            const comp = new TestComposite();
            comp.rebuild();

            expect(comp.getMinIntrinsicWidth(1)).toBe(5); // "hello".length
        });

        it("delegates getMaxIntrinsicWidth to rootChild", () => {
            const comp = new TestComposite();
            comp.rebuild();

            expect(comp.getMaxIntrinsicWidth(1)).toBe(5);
        });

        it("delegates getMinIntrinsicHeight to rootChild", () => {
            const comp = new TestComposite();
            comp.rebuild();

            expect(comp.getMinIntrinsicHeight(80)).toBe(1);
        });

        it("delegates getMaxIntrinsicHeight to rootChild", () => {
            const comp = new TestComposite();
            comp.rebuild();

            expect(comp.getMaxIntrinsicHeight(80)).toBe(1);
        });

        it("returns 0 when rootChild is null", () => {
            const comp = new TestComposite();
            // no rebuild()

            expect(comp.getMinIntrinsicWidth(1)).toBe(0);
            expect(comp.getMaxIntrinsicWidth(1)).toBe(0);
            expect(comp.getMinIntrinsicHeight(80)).toBe(0);
            expect(comp.getMaxIntrinsicHeight(80)).toBe(0);
        });
    });

    describe("layout", () => {
        it("positions rootChild at (0,0) relative to self", () => {
            const comp = new TestComposite();
            comp.rebuild();
            comp.localPosition = new Offset(10, 20);
            comp.layout(BoxConstraints.tight(new Size(80, 24)));

            const child = comp.getRootChild()!;
            expect(child.localPosition.dx).toBe(0);
            expect(child.localPosition.dy).toBe(0);
            expect(child.globalPosition.x).toBe(10);
            expect(child.globalPosition.y).toBe(20);
        });
    });

    describe("getChildren", () => {
        it("returns [rootChild] after rebuild", () => {
            const comp = new TestComposite();
            comp.rebuild();

            expect(comp.getChildren()).toEqual([comp.getRootChild()]);
        });

        it("returns [] before rebuild", () => {
            const comp = new TestComposite();
            expect(comp.getChildren()).toEqual([]);
        });
    });

    describe("render", () => {
        it("delegates render to rootChild", () => {
            const comp = new TestComposite();
            comp.rebuild();
            comp.localPosition = new Offset(0, 0);
            comp.layout(BoxConstraints.tight(new Size(80, 24)));

            const screen = new TerminalScreen(new Size(80, 24));
            const ctx = new RenderContext(screen);
            comp.render(ctx);

            expect((comp.getRootChild() as FakeLeaf).rendered).toBe(true);
        });
    });
});
