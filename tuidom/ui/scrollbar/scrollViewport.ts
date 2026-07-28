import { BoxConstraints, Offset, Point, Rect, Size } from "../../common/geometryPromitives.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";

import type { IContentSized, IScrollable } from "./iScrollable.ts";

/**
 * Scroll engine: wraps any content-sized child, owns the scroll state, and
 * clips rendering to the viewport bounds. The child draws full content in
 * local coordinates; ScrollViewport shifts by -scrollTop/-scrollLeft and
 * clips so only the visible region produces cells on screen.
 *
 * The child only needs to report contentHeight/contentWidth (IContentSized).
 * ScrollViewport itself implements IScrollable, so it can be nested inside
 * ScrollBarDecorator or any other consumer of IScrollable.
 */
export class ScrollViewport extends TUIElement implements IScrollable {
    private child: TUIElement & IContentSized;
    public scrollTop = 0;
    public scrollLeft = 0;

    public constructor(child: TUIElement & IContentSized) {
        super();
        this.child = child;
        this.appendChild(this.child);
    }

    public get contentHeight(): number {
        return this.child.contentHeight;
    }

    public get contentWidth(): number {
        return this.child.contentWidth;
    }

    public override getMaxIntrinsicWidth(_height: number): number {
        return this.child.contentWidth;
    }

    public override getMaxIntrinsicHeight(_width: number): number {
        return this.child.contentHeight;
    }

    public scrollBy(dx: number, dy: number): void {
        this.scrollTo(this.scrollLeft + dx, this.scrollTop + dy);
    }

    public scrollTo(left: number, top: number): void {
        const maxScrollTop = Math.max(0, this.contentHeight - this.layoutSize.height);
        const maxScrollLeft = Math.max(0, this.contentWidth - this.layoutSize.width);
        this.scrollTop = Math.max(0, Math.min(maxScrollTop, top));
        this.scrollLeft = Math.max(0, Math.min(maxScrollLeft, left));
    }

    public getChild(): TUIElement & IContentSized {
        return this.child;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);

        // Give child the full viewport size — it draws all content in local coords
        this.layoutChild(this.child, 0, 0, BoxConstraints.tight(size));

        return size;
    }

    public override render(context: RenderContext): void {
        const scrollOffset = new Offset(-this.scrollLeft, -this.scrollTop);
        const viewportClip = new Rect(this.globalPosition, this.layoutSize);
        this.child.render(context.withOffset(scrollOffset).withClip(viewportClip));
    }

    public override elementFromPoint(point: Point): TUIElement | null {
        const bounds = new Rect(this.globalPosition, this.layoutSize);
        if (!bounds.containsPoint(point)) return null;

        const scrolledPoint = new Point(point.x + this.scrollLeft, point.y + this.scrollTop);

        // Bypass content's bounds check — its layoutSize equals viewport size,
        // but children can live far beyond that in content coordinates.
        const children = this.child.getChildren();
        for (let i = children.length - 1; i >= 0; i--) {
            const hit = children[i].elementFromPoint(scrolledPoint);
            if (hit) return hit;
        }

        return this.child;
    }
}
