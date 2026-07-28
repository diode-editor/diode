import { BoxConstraints, Size } from "../../common/geometryPromitives.ts";
import { TUIElement } from "../../dom/tuiElement.ts";

export type VFlexChildSize = { type: "fixed"; value: number } | { type: "fit" } | { type: "fill" };

export interface VFlexLayoutStyle {
    height: VFlexChildSize;
    width: number | "fill";
}

export function vflexFixed(value: number): VFlexChildSize {
    return { type: "fixed", value };
}

export function vflexFit(): VFlexChildSize {
    return { type: "fit" };
}

export function vflexFill(): VFlexChildSize {
    return { type: "fill" };
}

/**
 * Вертикальный flex — зеркало {@link HFlexElement} с переставленными осями:
 * главная ось — высота (fixed/fit/fill, максимум один fill), поперечная —
 * ширина (число или "fill" на всю ширину контейнера). JSX-адаптер сознательно
 * не заведён — добавляется симметрично HFlex при первом JSX-потребителе.
 */
export class VFlexElement extends TUIElement {
    public addChild(child: TUIElement, style: VFlexLayoutStyle): void {
        if (style.height.type === "fill") {
            const hasFill = this.getChildren().some((c) => (c.layoutStyle as VFlexLayoutStyle).height.type === "fill");
            if (hasFill) {
                throw new Error("VFlexElement supports at most one fill child");
            }
        }
        child.layoutStyle = style;
        this.appendChild(child);
    }

    public replaceChildren(newChildren: TUIElement[]): void {
        let fillCount = 0;
        for (const child of newChildren) {
            const style = child.layoutStyle as VFlexLayoutStyle | undefined;
            if (style?.height.type === "fill") fillCount++;
        }
        if (fillCount > 1) {
            throw new Error("VFlexElement supports at most one fill child");
        }
        this.setChildren(newChildren);
    }

    // ─── Intrinsic Size ───

    public override getMinIntrinsicHeight(width: number): number {
        let sum = 0;
        for (const child of this.getChildren()) {
            const style = child.layoutStyle as VFlexLayoutStyle;
            if (style.height.type === "fixed") {
                sum += style.height.value;
            } else {
                sum += child.getMinIntrinsicHeight(width);
            }
        }
        return sum;
    }

    public override getMaxIntrinsicHeight(width: number): number {
        let sum = 0;
        for (const child of this.getChildren()) {
            const style = child.layoutStyle as VFlexLayoutStyle;
            if (style.height.type === "fixed") {
                sum += style.height.value;
            } else {
                sum += child.getMaxIntrinsicHeight(width);
            }
        }
        return sum;
    }

    public override getMinIntrinsicWidth(height: number): number {
        let max = 0;
        for (const child of this.getChildren()) {
            const style = child.layoutStyle as VFlexLayoutStyle;
            if (style.width === "fill") {
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
            const style = child.layoutStyle as VFlexLayoutStyle;
            if (style.width === "fill") {
                max = Math.max(max, child.getMaxIntrinsicWidth(height));
            } else {
                max = Math.max(max, style.width);
            }
        }
        return max;
    }

    // ─── Layout ───

    protected override performLayout(constraints: BoxConstraints): Size {
        const containerSize = super.performLayout(constraints);
        const containerWidth = containerSize.width;
        const containerHeight = containerSize.height;

        let fixedSum = 0;
        let fitSum = 0;

        // Pass 1: measure fixed and fit children
        for (const child of this.getChildren()) {
            const style = child.layoutStyle as VFlexLayoutStyle;
            const childWidth = style.width === "fill" ? containerWidth : style.width;

            if (style.height.type === "fixed") {
                fixedSum += style.height.value;
            } else if (style.height.type === "fit") {
                fitSum += child.getMaxIntrinsicHeight(childWidth);
            }
        }

        // Pass 2: compute fill height and lay out all children
        const remaining = Math.max(0, containerHeight - fixedSum - fitSum);
        let currentY = 0;

        for (const child of this.getChildren()) {
            const style = child.layoutStyle as VFlexLayoutStyle;
            const childWidth = style.width === "fill" ? containerWidth : style.width;

            let childHeight: number;
            if (style.height.type === "fixed") {
                childHeight = style.height.value;
            } else if (style.height.type === "fit") {
                childHeight = child.getMaxIntrinsicHeight(childWidth);
            } else {
                childHeight = remaining;
            }

            this.layoutChild(child, 0, currentY, BoxConstraints.tight(new Size(childWidth, childHeight)));
            currentY += childHeight;
        }

        return containerSize;
    }
}
