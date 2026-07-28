import { describe, expect, it } from "vitest";

import { renderElement } from "../../src/TestUtils/renderElement.ts";
import { BoxConstraints, Offset, Point, Size } from "../common/geometryPromitives.ts";

import { CompositeElement } from "./compositeElement.ts";
import type { ComponentType, JsxNode } from "./jsx/jsx-runtime.ts";
import { jsx } from "./jsx/jsx-runtime.ts";
import { RenderContext, TUIElement } from "./tuiElement.ts";

// A leaf with fixed intrinsic sizes that draws a single marker char and records
// the constraints / global position it was laid out with.
class MarkerLeaf extends TUIElement {
    public laidOutWith: BoxConstraints | null = null;

    public override getMinIntrinsicWidth(): number {
        return 4;
    }
    public override getMaxIntrinsicWidth(): number {
        return 7;
    }
    public override getMinIntrinsicHeight(): number {
        return 2;
    }
    public override getMaxIntrinsicHeight(): number {
        return 3;
    }

    public override performLayout(constraints: BoxConstraints): Size {
        this.laidOutWith = constraints;
        return super.performLayout(constraints);
    }

    public override render(context: RenderContext): void {
        context.setCell(0, 0, { char: "M" });
    }
}

const MarkerComponent: ComponentType<object> = (): MarkerLeaf => new MarkerLeaf();

class MarkerComposite extends CompositeElement {
    protected override describe(): JsxNode {
        return jsx(MarkerComponent, {});
    }
}

describe("CompositeElement proxy behavior (lines 72-84)", () => {
    it("proxies all four intrinsic-size queries to the built child", () => {
        const comp = new MarkerComposite();
        comp.rebuild();

        expect(comp.getMinIntrinsicWidth(0)).toBe(4);
        expect(comp.getMaxIntrinsicWidth(0)).toBe(7);
        expect(comp.getMinIntrinsicHeight(0)).toBe(2);
        expect(comp.getMaxIntrinsicHeight(0)).toBe(3);
    });

    it("resets a previously non-zero child localPosition to (0,0) during layout", () => {
        const comp = new MarkerComposite();
        comp.rebuild();

        const child = comp.getRootChild()!;
        // Pretend the child was previously positioned elsewhere.
        child.localPosition = new Offset(9, 9);

        comp.localPosition = new Offset(5, 6);
        comp.layout(BoxConstraints.tight(new Size(30, 8)));

        // The proxy forces the child to the composite origin.
        expect(child.localPosition).toEqual(new Offset(0, 0));
        // And the child inherits the composite's global position.
        expect(child.globalPosition).toEqual(new Point(5, 6));
        // The child is laid out tightly to the composite's resolved size.
        const leaf = child as MarkerLeaf;
        expect(leaf.laidOutWith!.maxWidth).toBe(30);
        expect(leaf.laidOutWith!.maxHeight).toBe(8);
    });

    it("renders the child shifted by the child's localPosition offset", () => {
        const comp = new MarkerComposite();
        comp.rebuild();

        // After layout the child localPosition is (0,0), so the marker lands at (0,0).
        const backend = renderElement(comp, 10, 3);

        expect(backend.getTextAt(new Point(0, 0), 1)).toBe("M");
    });
});
