import { BoxConstraints, Size } from "../common/geometryPromitives.ts";

import { TUIElement } from "./tuiElement.ts";

/**
 * Base class for composite elements that own a single root child built
 * imperatively in the subclass constructor via {@link setRootChild}.
 *
 * The composite fills its constraints, lays the child out tight to the
 * resulting size and proxies intrinsic dimensions to the child.
 */
export abstract class CompositeElement extends TUIElement {
    private rootChild: TUIElement | null = null;

    /** Replace the root child; called once from the subclass constructor. */
    protected setRootChild(child: TUIElement): void {
        if (this.rootChild) {
            this.removeChild(this.rootChild);
        }
        this.rootChild = child;
        this.appendChild(child);
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

    protected override performLayout(constraints: BoxConstraints): Size {
        const resultSize = super.performLayout(constraints);

        if (this.rootChild) {
            this.layoutChild(this.rootChild, 0, 0, BoxConstraints.tight(resultSize));
        }

        return resultSize;
    }

}
