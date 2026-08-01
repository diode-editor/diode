import { DEFAULT_COLOR } from "../../common/colorUtils.ts";
import { BoxConstraints, Offset, Point, Rect, Size } from "../../common/geometryPromitives.ts";
import type { JsxChild } from "../../dom/jsx/jsx-runtime.ts";
import { normalizeChildren, reconcileChildren } from "../../dom/jsx/reconcile.ts";
import type { StyleColor } from "../../dom/styles/tuiStyle.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";

export interface BoxContainerProps {
    bg?: StyleColor;
    fg?: StyleColor;
    borderFg?: StyleColor;
    title?: string;
    titleFg?: StyleColor;
    hasSeparator?: boolean;
    children?: JsxChild;
}

export class BoxContainerElement extends TUIElement {
    private bg: StyleColor;
    private fg: StyleColor;
    private borderFg: StyleColor;
    private title: string | undefined;
    private titleFg: StyleColor;
    private hasSeparator: boolean;
    private child: TUIElement | null = null;

    public constructor() {
        super();
        this.bg = DEFAULT_COLOR;
        this.fg = DEFAULT_COLOR;
        this.borderFg = DEFAULT_COLOR;
        this.titleFg = DEFAULT_COLOR;
        this.hasSeparator = false;
    }

    public setBg(value: StyleColor): void {
        this.bg = value;
        this.markDirty();
    }

    public setFg(value: StyleColor): void {
        this.fg = value;
        this.markDirty();
    }

    public setBorderFg(value: StyleColor): void {
        this.borderFg = value;
        this.markDirty();
    }

    public setTitle(value: string | undefined): void {
        this.title = value;
        this.markDirty();
    }

    public setTitleFg(value: StyleColor): void {
        this.titleFg = value;
        this.markDirty();
    }

    public setHasSeparator(value: boolean): void {
        this.hasSeparator = value;
        this.markDirty();
    }

    public setChild(child: TUIElement | null): void {
        if (this.child) {
            this.removeChild(this.child);
        }
        this.child = child;
        if (this.child) {
            this.appendChild(this.child);
        }
        this.markDirty();
    }

    private get headerRows(): number {
        if (!this.title) return 0;
        return this.hasSeparator ? 2 : 1;
    }

    public override getMinIntrinsicWidth(height: number): number {
        if (!this.child) return 2;
        return this.child.getMinIntrinsicWidth(height) + 2;
    }

    public override getMaxIntrinsicWidth(height: number): number {
        if (!this.child) return 2;
        return this.child.getMaxIntrinsicWidth(height) + 2;
    }

    public override getMinIntrinsicHeight(width: number): number {
        const paddingY = 2 + this.headerRows;
        if (!this.child) return paddingY;
        return this.child.getMinIntrinsicHeight(Math.max(0, width - 2)) + paddingY;
    }

    public override getMaxIntrinsicHeight(width: number): number {
        const paddingY = 2 + this.headerRows;
        if (!this.child) return paddingY;
        return this.child.getMaxIntrinsicHeight(Math.max(0, width - 2)) + paddingY;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const containerSize = super.performLayout(constraints);
        if (this.child) {
            const paddingX = 1;
            const paddingTop = 1 + this.headerRows;
            const paddingBottom = 1;
            const childWidth = Math.max(0, containerSize.width - paddingX * 2);
            const childHeight = Math.max(0, containerSize.height - paddingTop - paddingBottom);
            const childX = paddingX;
            const childY = paddingTop;
            this.layoutChild(this.child, childX, childY, BoxConstraints.tight(new Size(childWidth, childHeight)));
        }
        return containerSize;
    }

    public override render(context: RenderContext): void {
        const w = this.layoutSize.width;
        const h = this.layoutSize.height;

        // Fill background + frame (separator row when title has one).
        const separators = this.title && this.hasSeparator ? [2] : undefined;
        context.drawBox(0, 0, w, h, {
            fg: this.resolveColor(this.borderFg),
            bg: this.resolveColor(this.bg),
            fill: true,
            separators,
        });

        // Title row (y=1)
        if (this.title) {
            const titleX = Math.floor((w - this.title.length) / 2);
            context.drawText(titleX, 1, this.title, {
                fg: this.resolveColor(this.titleFg),
                bg: this.resolveColor(this.bg),
            });
        }

        // Render child
        this.renderChildren(context);
    }
}

// ─── BoxContainer JSX Adapter ───

function applyBoxContainerProps(el: BoxContainerElement, props: BoxContainerProps): void {
    if (props.bg !== undefined) el.setBg(props.bg);
    if (props.fg !== undefined) el.setFg(props.fg);
    if (props.borderFg !== undefined) el.setBorderFg(props.borderFg);
    el.setTitle(props.title);
    if (props.titleFg !== undefined) el.setTitleFg(props.titleFg);
    el.setHasSeparator(props.hasSeparator ?? false);
}

export function BoxContainer(props: BoxContainerProps): BoxContainerElement {
    const el = new BoxContainerElement();
    applyBoxContainerProps(el, props);
    if (props.children !== undefined) {
        const nodes = normalizeChildren(props.children);
        const children = reconcileChildren([], nodes);
        el.setChild(children[0] ?? null);
    }
    return el;
}

BoxContainer.update = (el: TUIElement, props: BoxContainerProps): void => {
    const box = el as BoxContainerElement;
    applyBoxContainerProps(box, props);
    const nodes = normalizeChildren(props.children);
    const newChildren = reconcileChildren(box.getChildren(), nodes);
    box.setChild(newChildren[0] ?? null);
};
