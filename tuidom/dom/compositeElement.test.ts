import { describe, expect, it } from "vitest";

import { BoxConstraints, Offset, Size } from "../common/geometryPromitives.ts";
import { TerminalScreen } from "../rendering/terminalScreen.ts";

import { CompositeElement } from "./compositeElement.ts";
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

class TestComposite extends CompositeElement {
    public constructor(text = "hello") {
        super();
        this.setRootChild(new FakeLeaf(text));
    }

    public replaceRoot(child: TUIElement): void {
        this.setRootChild(child);
    }
}

class EmptyComposite extends CompositeElement {}

// ─── Tests ───

describe("CompositeElement", () => {
    describe("setRootChild", () => {
        it("adopts the child built in the constructor", () => {
            const comp = new TestComposite();

            expect(comp.getRootChild()).toBeInstanceOf(FakeLeaf);
            expect((comp.getRootChild() as FakeLeaf).text).toBe("hello");
        });

        it("sets parent on rootChild", () => {
            const comp = new TestComposite();

            expect(comp.getRootChild()!.getParent()).toBe(comp);
        });

        it("replaces and detaches the previous rootChild", () => {
            const comp = new TestComposite();
            const first = comp.getRootChild()!;

            const next = new FakeLeaf("world");
            comp.replaceRoot(next);

            expect(comp.getRootChild()).toBe(next);
            expect(first.getParent()).toBeNull();
            expect(comp.getChildren()).toEqual([next]);
        });
    });

    describe("intrinsic size delegation", () => {
        it("delegates getMinIntrinsicWidth to rootChild", () => {
            const comp = new TestComposite();

            expect(comp.getMinIntrinsicWidth(1)).toBe(5); // "hello".length
        });

        it("delegates getMaxIntrinsicWidth to rootChild", () => {
            const comp = new TestComposite();

            expect(comp.getMaxIntrinsicWidth(1)).toBe(5);
        });

        it("delegates getMinIntrinsicHeight to rootChild", () => {
            const comp = new TestComposite();

            expect(comp.getMinIntrinsicHeight(80)).toBe(1);
        });

        it("delegates getMaxIntrinsicHeight to rootChild", () => {
            const comp = new TestComposite();

            expect(comp.getMaxIntrinsicHeight(80)).toBe(1);
        });

        it("returns 0 when rootChild is null", () => {
            const comp = new EmptyComposite();

            expect(comp.getMinIntrinsicWidth(1)).toBe(0);
            expect(comp.getMaxIntrinsicWidth(1)).toBe(0);
            expect(comp.getMinIntrinsicHeight(80)).toBe(0);
            expect(comp.getMaxIntrinsicHeight(80)).toBe(0);
        });
    });

    describe("layout", () => {
        it("positions rootChild at (0,0) relative to self", () => {
            const comp = new TestComposite();
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
        it("returns [rootChild]", () => {
            const comp = new TestComposite();

            expect(comp.getChildren()).toEqual([comp.getRootChild()]);
        });

        it("returns [] when no root child was set", () => {
            const comp = new EmptyComposite();
            expect(comp.getChildren()).toEqual([]);
        });
    });

    describe("render", () => {
        it("delegates render to rootChild", () => {
            const comp = new TestComposite();
            comp.localPosition = new Offset(0, 0);
            comp.layout(BoxConstraints.tight(new Size(80, 24)));

            const screen = new TerminalScreen(new Size(80, 24));
            const ctx = new RenderContext(screen);
            comp.render(ctx);

            expect((comp.getRootChild() as FakeLeaf).rendered).toBe(true);
        });
    });
});
