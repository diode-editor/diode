import { BoxConstraints, Offset, Point, Size } from "../../common/geometryPromitives.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";

/**
 * Контейнер «по содержимому»: занимает max-intrinsic размер единственного
 * ребёнка (в пределах входящих constraints) вместо того, чтобы растягиваться.
 * Типовой корень для диалогов/поповеров в overlay: слой даёт loose-constraints
 * на весь экран, а окно должно остаться размером с контент.
 */
export class FitContentElement extends TUIElement {
    private child: TUIElement | null = null;

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

    public getChild(): TUIElement | null {
        return this.child;
    }

    public override getMinIntrinsicWidth(height: number): number {
        return this.child?.getMinIntrinsicWidth(height) ?? 0;
    }

    public override getMaxIntrinsicWidth(height: number): number {
        return this.child?.getMaxIntrinsicWidth(height) ?? 0;
    }

    public override getMinIntrinsicHeight(width: number): number {
        return this.child?.getMinIntrinsicHeight(width) ?? 0;
    }

    public override getMaxIntrinsicHeight(width: number): number {
        return this.child?.getMaxIntrinsicHeight(width) ?? 0;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const w = this.getMaxIntrinsicWidth(0);
        const h = this.getMaxIntrinsicHeight(w);
        const resultSize = constraints.constrain(new Size(w, h));
        super.performLayout(BoxConstraints.tight(resultSize));

        if (this.child) {
            this.layoutChild(this.child, 0, 0, BoxConstraints.tight(resultSize));
        }

        return resultSize;
    }

    public override render(context: RenderContext): void {
        if (this.child) {
            this.child.render(context.withOffset(this.child.localPosition));
        }
    }
}
