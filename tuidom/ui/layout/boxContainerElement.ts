import { DEFAULT_COLOR } from "../../common/colorUtils.ts";
import { BoxConstraints, Offset, Point, Rect, Size } from "../../common/geometryPromitives.ts";
import { BORDER_THICKNESS } from "../../dom/borderStyle.ts";
import type { StyleColor } from "../../dom/styles/tuiStyle.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";

export class BoxContainerElement extends TUIElement {
    private bg: StyleColor;
    private borderFg: StyleColor;
    private title: string | undefined;
    private titleFg: StyleColor;
    private hasSeparator: boolean;
    private child: TUIElement | null = null;

    public constructor() {
        super();
        this.bg = DEFAULT_COLOR;
        this.borderFg = DEFAULT_COLOR;
        this.titleFg = DEFAULT_COLOR;
        this.hasSeparator = false;
    }

    public setBg(value: StyleColor): void {
        this.bg = value;
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

    /** Вклад рамки (+ строк заголовка) в размер: контент живёт внутри этих insets. */
    private get contentInsets(): { left: number; top: number; right: number; bottom: number } {
        return {
            left: BORDER_THICKNESS,
            top: BORDER_THICKNESS + this.headerRows,
            right: BORDER_THICKNESS,
            bottom: BORDER_THICKNESS,
        };
    }

    public override getMinIntrinsicWidth(height: number): number {
        const insetsX = this.contentInsets.left + this.contentInsets.right;
        if (!this.child) return insetsX;
        return this.child.getMinIntrinsicWidth(height) + insetsX;
    }

    public override getMaxIntrinsicWidth(height: number): number {
        const insetsX = this.contentInsets.left + this.contentInsets.right;
        if (!this.child) return insetsX;
        return this.child.getMaxIntrinsicWidth(height) + insetsX;
    }

    public override getMinIntrinsicHeight(width: number): number {
        const insets = this.contentInsets;
        const insetsY = insets.top + insets.bottom;
        if (!this.child) return insetsY;
        return this.child.getMinIntrinsicHeight(Math.max(0, width - insets.left - insets.right)) + insetsY;
    }

    public override getMaxIntrinsicHeight(width: number): number {
        const insets = this.contentInsets;
        const insetsY = insets.top + insets.bottom;
        if (!this.child) return insetsY;
        return this.child.getMaxIntrinsicHeight(Math.max(0, width - insets.left - insets.right)) + insetsY;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const containerSize = super.performLayout(constraints);
        if (this.child) {
            const insets = this.contentInsets;
            const childWidth = Math.max(0, containerSize.width - insets.left - insets.right);
            const childHeight = Math.max(0, containerSize.height - insets.top - insets.bottom);
            this.layoutChild(
                this.child,
                insets.left,
                insets.top,
                BoxConstraints.tight(new Size(childWidth, childHeight)),
            );
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
