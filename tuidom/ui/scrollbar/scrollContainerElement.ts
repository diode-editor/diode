import { BoxConstraints, Offset, Point, Rect, Size } from "../../common/geometryPromitives.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";

import type { IScrollable } from "./iScrollable.ts";
import type { ScrollBarColors } from "./scrollBarRenderer.ts";
import { renderHorizontalScrollBar, renderScrollBar } from "./scrollBarRenderer.ts";

export type ScrollBarPolicy = "auto" | "always" | "never";

/**
 * Draws scrollbars alongside a scrollable child.
 *
 * The child is rendered as-is — it must handle its own content rendering.
 * For simple widgets that draw full content in local coordinates, wrap
 * them in a ScrollViewport before passing to ScrollBarDecorator:
 *
 *   new ScrollBarDecorator(new ScrollViewport(textBlock))
 *
 * For self-scrolling widgets (e.g. EditorElement) that already manage
 * their own scroll offset, pass them directly:
 *
 *   new ScrollBarDecorator(editorElement)
 */
export class ScrollBarDecorator extends TUIElement {
    private child: TUIElement & IScrollable;
    public verticalScrollBar: ScrollBarPolicy = "auto";
    public horizontalScrollBar: ScrollBarPolicy = "auto";

    public constructor(child: TUIElement & IScrollable) {
        super();
        this.child = child;
        this.appendChild(this.child);
    }

    public getChild(): TUIElement & IScrollable {
        return this.child;
    }

    public setChild(child: TUIElement & IScrollable): void {
        // setChildren, а не appendChild: старый ребёнок обязан отцепиться. До
        // рефакторинга владения он молча оставался с parent=декоратор навсегда.
        this.child = child;
        this.setChildren([this.child]);
        this.markDirty();
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const containerSize = super.performLayout(constraints);

        const { showVertical, showHorizontal } = this.resolveScrollBarVisibility(containerSize);
        const childWidth = containerSize.width - (showVertical ? 1 : 0);
        const childHeight = containerSize.height - (showHorizontal ? 1 : 0);

        this.layoutChild(this.child, 0, 0, BoxConstraints.tight(new Size(childWidth, childHeight)));

        return containerSize;
    }

    public render(context: RenderContext): void {
        const { showVertical, showHorizontal } = this.resolveScrollBarVisibility(this.layoutSize);

        this.renderChildren(context);

        const childWidth = this.child.layoutSize.width;
        const childHeight = this.child.layoutSize.height;
        // Токены темы + фон колонки от КАСКАДА: декоратор внутри панели/сайдбара
        // наследует фон хозяина — бывшая параметризация getScrollBarStyles(theme,
        // backgroundKey) стала свойством дерева.
        const colors: ScrollBarColors = {
            thumb: this.styleVar("scrollbarSlider.background"),
            track: this.styleVar("scrollbar.background"),
            background: this.resolvedStyle.bg,
        };

        if (showVertical) {
            renderScrollBar(
                context,
                this.layoutSize.width - 1,
                childHeight,
                this.child.contentHeight,
                this.child.scrollTop,
                childHeight,
                colors,
            );
        }

        if (showHorizontal) {
            renderHorizontalScrollBar(
                context,
                this.layoutSize.height - 1,
                childWidth,
                this.child.contentWidth,
                this.child.scrollLeft,
                childWidth,
                colors,
            );
        }
    }

    private resolveScrollBarVisibility(containerSize: Size): { showVertical: boolean; showHorizontal: boolean } {
        const showVertical = this.resolvePolicy(this.verticalScrollBar, this.child.contentHeight, containerSize.height);
        const showHorizontal = this.resolvePolicy(
            this.horizontalScrollBar,
            this.child.contentWidth,
            containerSize.width - (showVertical ? 1 : 0),
        );
        return { showVertical, showHorizontal };
    }

    private resolvePolicy(policy: ScrollBarPolicy, contentSize: number, viewportSize: number): boolean {
        switch (policy) {
            case "always":
                return true;
            case "never":
                return false;
            case "auto":
                return contentSize > viewportSize;
        }
    }
}

/** @deprecated Use ScrollBarDecorator instead */
export const ScrollContainerElement = ScrollBarDecorator;
