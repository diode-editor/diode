import { BoxConstraints, Offset, Point, Rect, Size } from "../../common/geometryPromitives.ts";
import type { JsxChild } from "../../dom/jsx/jsx-runtime.ts";
import { normalizeChildren, reconcileChildren } from "../../dom/jsx/reconcile.ts";
import type { StyleColor } from "../../dom/styles/tuiStyle.ts";
import { TUIElement } from "../../dom/tuiElement.ts";

export interface Padding {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
}

export class PaddingContainerElement extends TUIElement {
    private child: TUIElement | null;
    private top: number;
    private right: number;
    private bottom: number;
    private left: number;

    public constructor(child: TUIElement | null, padding?: Padding) {
        super();
        this.child = child;
        if (this.child) this.appendChild(this.child);
        this.top = padding?.top ?? 0;
        this.right = padding?.right ?? 0;
        this.bottom = padding?.bottom ?? 0;
        this.left = padding?.left ?? 0;
    }

    public setChild(child: TUIElement | null): void {
        if (this.child) this.removeChild(this.child);
        this.child = child;
        if (this.child) this.appendChild(this.child);
        this.markDirty();
    }

    public override getMinIntrinsicWidth(height: number): number {
        const paddingX = this.left + this.right;
        if (!this.child) return paddingX;
        return this.child.getMinIntrinsicWidth(Math.max(0, height - this.top - this.bottom)) + paddingX;
    }

    public override getMaxIntrinsicWidth(height: number): number {
        const paddingX = this.left + this.right;
        if (!this.child) return paddingX;
        return this.child.getMaxIntrinsicWidth(Math.max(0, height - this.top - this.bottom)) + paddingX;
    }

    public override getMinIntrinsicHeight(width: number): number {
        const paddingY = this.top + this.bottom;
        if (!this.child) return paddingY;
        return this.child.getMinIntrinsicHeight(Math.max(0, width - this.left - this.right)) + paddingY;
    }

    public override getMaxIntrinsicHeight(width: number): number {
        const paddingY = this.top + this.bottom;
        if (!this.child) return paddingY;
        return this.child.getMaxIntrinsicHeight(Math.max(0, width - this.left - this.right)) + paddingY;
    }

    public getPaddingTop(): number {
        return this.top;
    }

    public setPaddingTop(value: number): void {
        this.top = value;
        this.markDirty();
    }

    public getPaddingRight(): number {
        return this.right;
    }

    public setPaddingRight(value: number): void {
        this.right = value;
        this.markDirty();
    }

    public getPaddingBottom(): number {
        return this.bottom;
    }

    public setPaddingBottom(value: number): void {
        this.bottom = value;
        this.markDirty();
    }

    public getPaddingLeft(): number {
        return this.left;
    }

    public setPaddingLeft(value: number): void {
        this.left = value;
        this.markDirty();
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const containerSize = super.performLayout(constraints);

        if (this.child) {
            const childWidth = Math.max(0, containerSize.width - this.left - this.right);
            const childHeight = Math.max(0, containerSize.height - this.top - this.bottom);
            this.layoutChild(this.child, this.left, this.top, BoxConstraints.tight(new Size(childWidth, childHeight)));
        }

        return containerSize;
    }
}

// ─── PaddingContainer JSX Adapter ───

export interface PaddingContainerProps extends Padding {
    bg?: StyleColor;
    fg?: StyleColor;
    children?: JsxChild;
}

export function PaddingContainer(props: PaddingContainerProps): PaddingContainerElement {
    const nodes = normalizeChildren(props.children);
    const children = reconcileChildren([], nodes);
    const padding = { top: props.top, right: props.right, bottom: props.bottom, left: props.left };
    const el = new PaddingContainerElement(children[0] ?? null, padding);
    if (props.bg !== undefined || props.fg !== undefined) {
        el.style = { bg: props.bg, fg: props.fg };
    }
    return el;
}

PaddingContainer.update = (el: TUIElement, props: PaddingContainerProps): void => {
    const pad = el as PaddingContainerElement;
    pad.setPaddingTop(props.top ?? 0);
    pad.setPaddingRight(props.right ?? 0);
    pad.setPaddingBottom(props.bottom ?? 0);
    pad.setPaddingLeft(props.left ?? 0);
    pad.style = { bg: props.bg, fg: props.fg };
    const nodes = normalizeChildren(props.children);
    const newChildren = reconcileChildren(pad.getChildren(), nodes);
    pad.setChild(newChildren[0] ?? null);
};
