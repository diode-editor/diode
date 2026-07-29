import { BoxConstraints, Point, Rect, Size } from "../../common/geometryPromitives.ts";
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
    public addChild(child: TUIElement, style: VStackLayoutStyle): void {
        child.layoutStyle = style;
        this.appendChild(child);
    }

    public replaceChildren(newChildren: TUIElement[]): void {
        this.setChildren(newChildren);
    }

    public override getMinIntrinsicWidth(height: number): number {
        let max = 0;
        for (const child of this.getChildren()) {
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
        for (const child of this.getChildren()) {
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
        for (const child of this.getChildren()) {
            const style = child.layoutStyle as VStackLayoutStyle;
            sum += style.height;
        }
        return sum;
    }

    public override getMaxIntrinsicHeight(_width: number): number {
        let sum = 0;
        for (const child of this.getChildren()) {
            const style = child.layoutStyle as VStackLayoutStyle;
            sum += style.height;
        }
        return sum;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        // First, call parent implementation to set allocatedSize and mark as clean
        const containerSize = super.performLayout(constraints);
        const containerWidth = containerSize.width;
        let currentY = 0;

        for (const child of this.getChildren()) {
            const style = child.layoutStyle as VStackLayoutStyle;
            // Инвариант вложенности (Н2): дети не вылезают за контейнер — при
            // нехватке места жадный кламп по остатку в порядке детей.
            const childWidth = Math.min(
                style.width === "fill" || style.width === "stretch" ? containerWidth : style.width,
                containerWidth,
            );
            const childHeight = Math.max(0, Math.min(style.height, containerSize.height - currentY));
            const childSize = new Size(childWidth, childHeight);

            // Store in layoutState for compatibility
            child.layoutState = {
                rect: new Rect(new Point(0, currentY), childSize),
            };

            this.layoutChild(child, 0, currentY, BoxConstraints.tight(childSize));

            currentY += childHeight;
        }

        return containerSize;
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
