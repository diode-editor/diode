import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { SashElement } from "@tuidom/elements/sash/sashElement";

/** Upstream's `minimumSize` of the content (200px) in cells. */
export const MIN_CONTENT_WIDTH = 25;
/** Upstream's `minimumSize` of the tree (100px) in cells. */
export const MIN_TREE_WIDTH = 12;

/**
 * Upstream's `proportionalLayout` split: the content takes `contentShare` of the width (halves, `Sizing.Distribute`,
 * until the sash is dragged), the tree keeps its minimum while the content can keep its own. When the width cannot
 * hold both minimums the content keeps its own and the tree gives way first, down to nothing.
 */
export function splitWidths(width: number, contentShare = 0.5): { readonly content: number; readonly tree: number } {
    const preferred = Math.min(width - MIN_TREE_WIDTH, Math.round(width * contentShare));
    const content = Math.min(width, Math.max(MIN_CONTENT_WIDTH, preferred));
    return { content, tree: width - content };
}

/**
 * Upstream `TestResultsViewContent`'s horizontal split: the content and the tree side by side, the tree on the right
 * unless `treeLeft`. A sash on the right part's first column (not the left part's last, where its scrollbar is) drags
 * the boundary; it is invisible at rest. The content's share of the width lives as long as the element — the whole
 * session, like upstream's in-memory `lastSplitWidth` — and survives `setTreeLeft` and `setContent`.
 */
export class TestResultsSplitElement extends TUIElement {
    private readonly sash = new SashElement("vertical");
    private contentShare = 0.5;

    public constructor(
        private content: TUIElement,
        private readonly tree: TUIElement,
        private treeLeft: boolean,
    ) {
        super();
        this.sash.onDrag = (boundaryScreenX) => {
            const width = this.layoutSize.width;
            const boundary = boundaryScreenX - this.globalPosition.x;
            const content = this.treeLeft ? width - boundary : boundary;
            this.contentShare = Math.max(MIN_CONTENT_WIDTH, Math.min(width - MIN_TREE_WIDTH, content)) / width;
            this.markDirty();
        };
        this.syncChildren();
    }

    /** `workbench.sash.hoverDelay`. */
    public set sashHoverDelay(ms: number) {
        this.sash.hoverDelay = ms;
    }

    /** The output's surface or a message's view. */
    public setContent(content: TUIElement): void {
        this.content = content;
        this.syncChildren();
    }

    public setTreeLeft(treeLeft: boolean): void {
        this.treeLeft = treeLeft;
        this.markDirty();
    }

    /** The sash goes last: on top for hit-testing. */
    private syncChildren(): void {
        this.setChildren([this.content, this.tree, this.sash]);
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        const widths = splitWidths(size.width, this.contentShare);
        const contentX = this.treeLeft ? widths.tree : 0;
        const treeX = this.treeLeft ? 0 : widths.content;
        this.layoutChild(this.content, contentX, 0, BoxConstraints.tight(new Size(widths.content, size.height)));
        this.layoutChild(this.tree, treeX, 0, BoxConstraints.tight(new Size(widths.tree, size.height)));
        // Laid out explicitly, otherwise its stale box sits at (0,0). No tree, no boundary: zero width catches nothing.
        const sashWidth = Math.min(1, widths.tree);
        this.layoutChild(this.sash, Math.max(contentX, treeX), 0, BoxConstraints.tight(new Size(sashWidth, size.height)));
        return size;
    }
}
