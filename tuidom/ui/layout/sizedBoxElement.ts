import { BoxConstraints, Offset, Point, Rect, Size } from "../../common/geometryPromitives.ts";
import type { JsxChild } from "../../dom/jsx/jsx-runtime.ts";
import { normalizeChildren, reconcileChildren } from "../../dom/jsx/reconcile.ts";
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

    public override performLayout(constraints: BoxConstraints): Size {
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
            this.child.render(context.withOffset(childOffset).withClip(childClip));
        }
    }
}

// ─── SizedBox JSX Adapter ───

export interface SizedBoxProps {
    width?: number;
    height?: number;
    children?: JsxChild;
}

function applySizedBoxProps(el: SizedBoxElement, props: SizedBoxProps): void {
    el.setPreferredWidth(props.width);
    el.setPreferredHeight(props.height);
}

export function SizedBox(props: SizedBoxProps): SizedBoxElement {
    const el = new SizedBoxElement(props.width, props.height);
    if (props.children !== undefined) {
        const nodes = normalizeChildren(props.children);
        const children = reconcileChildren([], nodes);
        el.setChild(children[0] ?? null);
    }
    return el;
}

SizedBox.update = (el: TUIElement, props: SizedBoxProps): void => {
    const box = el as SizedBoxElement;
    applySizedBoxProps(box, props);
    const nodes = normalizeChildren(props.children);
    const newChildren = reconcileChildren(box.getChildren(), nodes);
    box.setChild(newChildren[0] ?? null);
};
