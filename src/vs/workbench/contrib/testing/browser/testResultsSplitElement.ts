import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIElement } from "@tuidom/core/dom/tuiElement";

/** Upstream's `minimumSize` of the content (200px) in cells. */
export const MIN_CONTENT_WIDTH = 25;

/**
 * Upstream `Sizing.Distribute`: halves. The content keeps its minimum while the width allows: the tree gives way
 * first, down to nothing (upstream's 100px of the tree, 12 cells, hold from 37 columns up).
 */
export function splitWidths(width: number): { readonly content: number; readonly tree: number } {
    const content = Math.min(width, Math.max(MIN_CONTENT_WIDTH, width - Math.floor(width / 2)));
    return { content, tree: width - content };
}

/**
 * Upstream `TestResultsViewContent`'s horizontal split: the content and the tree side by side, the tree on the right
 * unless `treeLeft`. Deviation: there is no sash, the halves are fixed (upstream drags the boundary).
 */
export class TestResultsSplitElement extends TUIElement {
    public constructor(
        private readonly content: TUIElement,
        private readonly tree: TUIElement,
        private treeLeft: boolean,
    ) {
        super();
        this.setChildren([content, tree]);
    }

    public setTreeLeft(treeLeft: boolean): void {
        this.treeLeft = treeLeft;
        this.markDirty();
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        const widths = splitWidths(size.width);
        const contentX = this.treeLeft ? widths.tree : 0;
        const treeX = this.treeLeft ? 0 : widths.content;
        this.layoutChild(this.content, contentX, 0, BoxConstraints.tight(new Size(widths.content, size.height)));
        this.layoutChild(this.tree, treeX, 0, BoxConstraints.tight(new Size(widths.tree, size.height)));
        return size;
    }
}
