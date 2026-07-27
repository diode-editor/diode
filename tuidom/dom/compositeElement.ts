import { BoxConstraints, Offset, Point, Rect, Size } from "../common/geometryPromitives.ts";

import type { JsxNode } from "./jsx/jsx-runtime.ts";
import { reconcile } from "./jsx/reconcile.ts";
import { RenderContext, TUIElement } from "./tuiElement.ts";

/**
 * Base class for composite elements that describe their child tree
 * via a `describe()` method returning a JSX Blueprint.
 *
 * Usage:
 * ```tsx
 * class MyElement extends CompositeElement {
 *     describe() {
 *         return <TextLabel text="hello" />;
 *     }
 * }
 * ```
 *
 * Call `this.rebuild()` whenever state changes to reconcile the child tree.
 * The first `rebuild()` is typically called at the end of the constructor.
 */
export abstract class CompositeElement extends TUIElement {
    private rootChild: TUIElement | null = null;

    /**
     * Return a Blueprint or TUIElement describing this component's child tree.
     * Called by `rebuild()` during reconciliation.
     */
    protected abstract describe(): JsxNode;

    /**
     * Reconcile the child tree: calls `describe()`, diffs against the current
     * rootChild, and creates/updates elements as needed.
     */
    public rebuild(): void {
        const node = this.describe();
        this.rootChild = reconcile(this.rootChild, node);
        this.setChildren([this.rootChild]);
        this.markDirty();
    }

    public getRootChild(): TUIElement | null {
        return this.rootChild;
    }

    // ─── Proxy to rootChild ───

    public override getMinIntrinsicWidth(height: number): number {
        return this.rootChild?.getMinIntrinsicWidth(height) ?? 0;
    }

    public override getMaxIntrinsicWidth(height: number): number {
        return this.rootChild?.getMaxIntrinsicWidth(height) ?? 0;
    }

    public override getMinIntrinsicHeight(width: number): number {
        return this.rootChild?.getMinIntrinsicHeight(width) ?? 0;
    }

    public override getMaxIntrinsicHeight(width: number): number {
        return this.rootChild?.getMaxIntrinsicHeight(width) ?? 0;
    }

    public override performLayout(constraints: BoxConstraints): Size {
        const resultSize = super.performLayout(constraints);

        if (this.rootChild) {
            this.layoutChild(this.rootChild, 0, 0, BoxConstraints.tight(resultSize));
        }

        return resultSize;
    }

}
