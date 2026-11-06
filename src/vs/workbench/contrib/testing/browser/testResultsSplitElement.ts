import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIElement } from "@tuidom/core/dom/tuiElement";

/** Upstream's `minimumSize` of the content (200px) and of the tree (100px), in cells. */
export const MIN_CONTENT_WIDTH = 25;
export const MIN_TREE_WIDTH = 12;

/**
 * Upstream `Sizing.Distribute`: halves. The content keeps its minimum while the width allows: the tree gives way
 * first, down to nothing.
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
    private treeLeftValue = false;

    public constructor(
        private content: TUIElement,
        private readonly tree: TUIElement,
    ) {
        super();
        this.setChildren([content, tree]);
    }

    public get treeLeft(): boolean {
        return this.treeLeftValue;
    }

    public set treeLeft(value: boolean) {
        this.treeLeftValue = value;
        this.markDirty();
    }

    public setContent(content: TUIElement): void {
        this.replaceChild(this.content, content);
        this.content = content;
        this.markDirty();
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        const widths = splitWidths(size.width);
        const contentX = this.treeLeftValue ? widths.tree : 0;
        const treeX = this.treeLeftValue ? 0 : widths.content;
        this.layoutChild(this.content, contentX, 0, BoxConstraints.tight(new Size(widths.content, size.height)));
        this.layoutChild(this.tree, treeX, 0, BoxConstraints.tight(new Size(widths.tree, size.height)));
        return size;
    }
}
