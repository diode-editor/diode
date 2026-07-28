import { describe, expect, it } from "vitest";

import { renderElement } from "../../src/TestUtils/renderElement.ts";
import { BoxConstraints, Offset, Point, Size } from "../common/geometryPromitives.ts";
import { TerminalScreen } from "../rendering/terminalScreen.ts";

import { CompositeElement } from "./compositeElement.ts";
import type { JsxNode } from "./jsx/jsx-runtime.ts";
import type { ComponentType } from "./jsx/jsx-runtime.ts";
import { jsx } from "./jsx/jsx-runtime.ts";
import { RenderContext, TUIElement } from "./tuiElement.ts";

// A leaf that records the constraints it was laid out with and draws a marker char.
class RecordingLeaf extends TUIElement {
    public laidOutWith: BoxConstraints | null = null;
    public renderedAt: Point | null = null;

    public override performLayout(constraints: BoxConstraints): Size {
        this.laidOutWith = constraints;
        return super.performLayout(constraints);
    }

    public override render(context: RenderContext): void {
        context.setCell(0, 0, { char: "X" });
        this.renderedAt = this.globalPosition;
    }
}

const LeafComponent: ComponentType<object> = (): RecordingLeaf => new RecordingLeaf();

class TestComposite extends CompositeElement {
    protected override describe(): JsxNode {
        return jsx(LeafComponent, {});
    }
}

// A composite that never builds a child.
class EmptyComposite extends CompositeElement {
    protected override describe(): JsxNode {
        return new TUIElement();
    }
}

describe("CompositeElement layout proxy", () => {
    it("lays the rootChild out with tight constraints matching the composite size", () => {
        const comp = new TestComposite();
        comp.rebuild();
        comp.localPosition = new Offset(3, 4);
        comp.layout(BoxConstraints.tight(new Size(40, 12)));

        const leaf = comp.getRootChild() as RecordingLeaf;
        expect(leaf.laidOutWith).not.toBeNull();
        // The child must be sized exactly to the composite's resolved size.
        expect(leaf.laidOutWith!.minWidth).toBe(40);
        expect(leaf.laidOutWith!.maxWidth).toBe(40);
        expect(leaf.laidOutWith!.minHeight).toBe(12);
        expect(leaf.laidOutWith!.maxHeight).toBe(12);
        // Child inherits the composite's global position.
        expect(leaf.globalPosition).toEqual(new Point(3, 4));
    });

    it("does not throw when performLayout runs before any rebuild (null rootChild)", () => {
        const comp = new EmptyComposite();
        // No rebuild → rootChild is null.
        expect(() => {
            comp.layout(BoxConstraints.tight(new Size(10, 4)));
        }).not.toThrow();
        expect(comp.getRootChild()).toBeNull();
    });

    it("renders the rootChild at the composite's offset", () => {
        const comp = new TestComposite();
        comp.rebuild();
        const backend = renderElement(comp, 20, 5);

        const leaf = comp.getRootChild() as RecordingLeaf;
        expect(leaf.renderedAt).toEqual(new Point(0, 0));
        expect(backend.getTextAt(new Point(0, 0), 1)).toBe("X");
    });

    it("does not throw when render runs before any rebuild (null rootChild)", () => {
        const comp = new EmptyComposite();
        const screen = new TerminalScreen(new Size(10, 3));
        expect(() => {
            comp.render(new RenderContext(screen));
        }).not.toThrow();
    });
});
