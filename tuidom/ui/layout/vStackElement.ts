import { BoxConstraints, Offset, Point, Rect, Size } from "../../common/geometryPromitives.ts";
import type { JsxChild } from "../../dom/jsx/jsx-runtime.ts";
import { normalizeChildren, reconcileChildren } from "../../dom/jsx/reconcile.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";

export interface VStackLayoutStyle {
    width: number | "fill" | "stretch";
    height: number;
}

export interface VStackLayoutState {
    rect: Rect;
}

export class VStackElement extends TUIElement {
    private children: TUIElement[] = [];

    public addChild(child: TUIElement, style: VStackLayoutStyle): void {
        child.layoutStyle = style;
        child.setParent(this); // Set parent for dirty propagation
        this.children.push(child);
    }

    public replaceChildren(newChildren: TUIElement[]): void {
        const oldSet = new Set(this.children);
        const newSet = new Set(newChildren);

        for (const old of oldSet) {
            if (!newSet.has(old)) {
                old.setParent(null);
            }
        }

        this.children = newChildren;
        for (const child of newChildren) {
            child.setParent(this);
        }
    }

    public getChildren(): readonly TUIElement[] {
        return this.children;
    }

    public override getMinIntrinsicWidth(height: number): number {
        let max = 0;
        for (const child of this.children) {
            const style = child.layoutStyle as VStackLayoutStyle;
            if (style.width === "fill" || style.width === "stretch") {
                max = Math.max(max, child.getMinIntrinsicWidth(height));
            } else {
                max = Math.max(max, style.width);
            }
        }
        return max;
    }

    public override getMaxIntrinsicWidth(height: number): number {
        let max = 0;
        for (const child of this.children) {
            const style = child.layoutStyle as VStackLayoutStyle;
            if (style.width === "fill" || style.width === "stretch") {
                max = Math.max(max, child.getMaxIntrinsicWidth(height));
            } else {
                max = Math.max(max, style.width);
            }
        }
        return max;
    }

    public override getMinIntrinsicHeight(_width: number): number {
        let sum = 0;
        for (const child of this.children) {
            const style = child.layoutStyle as VStackLayoutStyle;
            sum += style.height;
        }
        return sum;
    }

    public override getMaxIntrinsicHeight(_width: number): number {
        let sum = 0;
        for (const child of this.children) {
            const style = child.layoutStyle as VStackLayoutStyle;
            sum += style.height;
        }
        return sum;
    }

    public performLayout(constraints: BoxConstraints): Size {
        // First, call parent implementation to set allocatedSize and mark as clean
        const containerSize = super.performLayout(constraints);
        const containerWidth = containerSize.width;
        let currentY = 0;

        for (const child of this.children) {
            const style = child.layoutStyle as VStackLayoutStyle;
            const childWidth = style.width === "fill" || style.width === "stretch" ? containerWidth : style.width;
            const childHeight = style.height;
            const childSize = new Size(childWidth, childHeight);

            // Set local position (relative to this container)
            child.localPosition = new Offset(0, currentY);

            // Store in layoutState for compatibility
            child.layoutState = {
                rect: new Rect(new Point(0, currentY), childSize),
            };

            // Perform child layout
            child.performLayout(BoxConstraints.tight(childSize));

            currentY += childHeight;
        }

        return containerSize;
    }

    public render(context: RenderContext): void {
        for (const child of this.children) {
            // Use localPosition from coordinate system instead of layoutState
            const childOffset = new Offset(child.localPosition.dx, child.localPosition.dy);
            const childClip = new Rect(child.globalPosition, child.layoutSize);
            child.render(context.withOffset(childOffset).withClip(childClip));
        }
    }
}

// ─── VStack JSX Adapter ───

export interface VStackProps {
    children?: JsxChild | JsxChild[];
}

export function VStack(props: VStackProps): VStackElement {
    const el = new VStackElement();
    const nodes = normalizeChildren(props.children);
    const children = reconcileChildren([], nodes);
    for (const child of children) {
        el.addChild(child, child.layoutStyle as VStackLayoutStyle);
    }
    return el;
}

VStack.update = (el: TUIElement, props: VStackProps): void => {
    const vstack = el as VStackElement;
    const nodes = normalizeChildren(props.children);
    const newChildren = reconcileChildren(vstack.getChildren(), nodes);
    vstack.replaceChildren(newChildren);
};
