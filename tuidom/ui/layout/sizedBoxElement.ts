import { BoxConstraints, Offset, Point, Rect, Size } from "../../common/geometryPromitives.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";

/**
 * Контейнер фиксированного «предпочтительного» размера: под входящими
 * constraints резолвит размер как `preferredWidth`/`preferredHeight`
 * (заклампленный в `[min, max]`) и кладёт единственного ребёнка tight на этот
 * размер. Неуказанная ось делегируется max-intrinsic ребёнка (по этой оси
 * ведёт себя как {@link FitContentElement}).
 *
 * Нужен для overlay-виджетов фиксированной ширины: слой даёт loose-constraints
 * на всю доступную область, а виджету надо занять свой предпочтительный размер
 * (FitContent тянется по контенту, HFlex/VStack — по детям, выразить нечем).
 * Полностью theme-agnostic: цветов не знает.
 */
export class SizedBoxElement extends TUIElement {
    private child: TUIElement | null = null;
    private preferredWidth: number | undefined;
    private preferredHeight: number | undefined;

    public constructor(preferredWidth?: number, preferredHeight?: number) {
        super();
        this.preferredWidth = preferredWidth;
        this.preferredHeight = preferredHeight;
    }

    public setPreferredWidth(value: number | undefined): void {
        this.preferredWidth = value;
        this.markDirty();
    }

    public setPreferredHeight(value: number | undefined): void {
        this.preferredHeight = value;
        this.markDirty();
    }

    public setChild(child: TUIElement | null): void {
        if (this.child) this.removeChild(this.child);
        this.child = child;
        if (this.child) this.appendChild(this.child);
        this.markDirty();
    }

    public getChild(): TUIElement | null {
        return this.child;
    }

    public override getMinIntrinsicWidth(height: number): number {
        return this.preferredWidth ?? this.child?.getMinIntrinsicWidth(height) ?? 0;
    }

    public override getMaxIntrinsicWidth(height: number): number {
        return this.preferredWidth ?? this.child?.getMaxIntrinsicWidth(height) ?? 0;
    }

    public override getMinIntrinsicHeight(width: number): number {
        return this.preferredHeight ?? this.child?.getMinIntrinsicHeight(width) ?? 0;
    }

    public override getMaxIntrinsicHeight(width: number): number {
        return this.preferredHeight ?? this.child?.getMaxIntrinsicHeight(width) ?? 0;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const desiredWidth = this.getMaxIntrinsicWidth(this.preferredHeight ?? 0);
        const desiredHeight = this.getMaxIntrinsicHeight(desiredWidth);
        const size = constraints.constrain(new Size(desiredWidth, desiredHeight));
        super.performLayout(BoxConstraints.tight(size));

        if (this.child) {
            this.layoutChild(this.child, 0, 0, BoxConstraints.tight(size));
        }

        return size;
    }

    public override render(context: RenderContext): void {
        if (this.child) {
            const childOffset = new Offset(this.child.localPosition.dx, this.child.localPosition.dy);
            const childClip = new Rect(this.child.globalPosition, this.child.layoutSize);
            const childContext = context.withOffset(childOffset).withClip(childClip);
            if (childContext.clipRect.isEmpty) return;
            this.child.render(childContext);
        }
    }
}
