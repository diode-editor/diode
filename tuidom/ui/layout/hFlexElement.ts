import { BoxConstraints, Offset, Point, Rect, Size } from "../../common/geometryPromitives.ts";
import type { JsxChild, JsxNode } from "../../dom/jsx/jsx-runtime.ts";
import { normalizeChildren, reconcileChildren } from "../../dom/jsx/reconcile.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";

export type HFlexChildSize = { type: "fixed"; value: number } | { type: "fit" } | { type: "fill" };

export interface HFlexLayoutStyle {
    width: HFlexChildSize;
    height: number | "fill";
}

export function hflexFixed(value: number): HFlexChildSize {
    return { type: "fixed", value };
}

export function hflexFit(): HFlexChildSize {
    return { type: "fit" };
}

export function hflexFill(): HFlexChildSize {
    return { type: "fill" };
}

export class HFlexElement extends TUIElement {
    public addChild(child: TUIElement, style: HFlexLayoutStyle): void {
        if (style.width.type === "fill") {
            const hasFill = this.getChildren().some((c) => (c.layoutStyle as HFlexLayoutStyle).width.type === "fill");
            if (hasFill) {
                throw new Error("HFlexElement supports at most one fill child");
            }
        }
        child.layoutStyle = style;
        this.appendChild(child);
    }

    public replaceChildren(newChildren: TUIElement[]): void {
        let fillCount = 0;
        for (const child of newChildren) {
            const style = child.layoutStyle as HFlexLayoutStyle | undefined;
            if (style?.width.type === "fill") fillCount++;
        }
        if (fillCount > 1) {
            throw new Error("HFlexElement supports at most one fill child");
        }
        this.setChildren(newChildren);
    }

    // ─── Intrinsic Size ───

    public override getMinIntrinsicWidth(height: number): number {
        let sum = 0;
        for (const child of this.getChildren()) {
            const style = child.layoutStyle as HFlexLayoutStyle;
            if (style.width.type === "fixed") {
                sum += style.width.value;
            } else {
                sum += child.getMinIntrinsicWidth(height);
            }
        }
        return sum;
    }

    public override getMaxIntrinsicWidth(height: number): number {
        let sum = 0;
        for (const child of this.getChildren()) {
            const style = child.layoutStyle as HFlexLayoutStyle;
            if (style.width.type === "fixed") {
                sum += style.width.value;
            } else {
                sum += child.getMaxIntrinsicWidth(height);
            }
        }
        return sum;
    }

    public override getMinIntrinsicHeight(width: number): number {
        let max = 0;
        for (const child of this.getChildren()) {
            const style = child.layoutStyle as HFlexLayoutStyle;
            if (style.height === "fill") {
                max = Math.max(max, child.getMinIntrinsicHeight(width));
            } else {
                max = Math.max(max, style.height);
            }
        }
        return max;
    }

    public override getMaxIntrinsicHeight(width: number): number {
        let max = 0;
        for (const child of this.getChildren()) {
            const style = child.layoutStyle as HFlexLayoutStyle;
            if (style.height === "fill") {
                max = Math.max(max, child.getMaxIntrinsicHeight(width));
            } else {
                max = Math.max(max, style.height);
            }
        }
        return max;
    }

    // ─── Layout ───

    public override performLayout(constraints: BoxConstraints): Size {
        const containerSize = super.performLayout(constraints);
        const containerWidth = containerSize.width;
        const containerHeight = containerSize.height;

        let fixedSum = 0;
        let fitSum = 0;
        let fillChild: TUIElement | null = null;

        // Pass 1: measure fixed and fit children
        for (const child of this.getChildren()) {
            const style = child.layoutStyle as HFlexLayoutStyle;
            const childHeight = style.height === "fill" ? containerHeight : style.height;

            if (style.width.type === "fixed") {
                fixedSum += style.width.value;
            } else if (style.width.type === "fit") {
                fitSum += child.getMaxIntrinsicWidth(childHeight);
            } else {
                fillChild = child;
            }
        }

        // Pass 2: compute fill width and lay out all children
        const remaining = Math.max(0, containerWidth - fixedSum - fitSum);
        let currentX = 0;

        for (const child of this.getChildren()) {
            const style = child.layoutStyle as HFlexLayoutStyle;
            const childHeight = style.height === "fill" ? containerHeight : style.height;

            let childWidth: number;
            if (style.width.type === "fixed") {
                childWidth = style.width.value;
            } else if (style.width.type === "fit") {
                childWidth = child.getMaxIntrinsicWidth(childHeight);
            } else {
                childWidth = remaining;
            }

            this.layoutChild(child, currentX, 0, BoxConstraints.tight(new Size(childWidth, childHeight)));
            currentX += childWidth;
        }

        return containerSize;
    }

    // ─── Render ───

}

// ─── HFlex JSX Adapter ───

export interface HFlexProps {
    children?: JsxChild | JsxChild[];
}

export function HFlex(props: HFlexProps): HFlexElement {
    const el = new HFlexElement();
    const nodes = normalizeChildren(props.children);
    const children = reconcileChildren([], nodes);
    for (const child of children) {
        el.addChild(child, child.layoutStyle as HFlexLayoutStyle);
    }
    return el;
}

HFlex.update = (el: TUIElement, props: HFlexProps): void => {
    const hflex = el as HFlexElement;
    const nodes = normalizeChildren(props.children);
    const newChildren = reconcileChildren(hflex.getChildren(), nodes);
    hflex.replaceChildren(newChildren);
};
