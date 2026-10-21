import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { BORDER_THICKNESS } from "@tuidom/core/dom/borderStyle";
import { RenderContext, TUIElement } from "@tuidom/core/dom/tuiElement";
import { wrapText } from "@tuidom/elements/completionlist/completionDetailsElement";

import {
    HOVER_BOX_DEFAULT_MAX_WIDTH,
    HOVER_BOX_TEXT_X,
    hoverBoxSize,
    hoverTextWidth,
    hoverTextWidthIn,
    hoverVisibleLineCount,
    naturalWidth,
    WidthKeyedCache,
} from "./hoverBox.ts";
/** v1 height clamp: a long hover is truncated; scrolling is a separate task. */
const DEFAULT_MAX_HEIGHT = 12;

interface IWrappedLines {
    readonly lines: readonly string[];
    readonly separators: ReadonlySet<number>;
}

/**
 * Markdown never gets here: HoverService strips it. Lives outside tuidom: a per-char render
 * on top of drawBox can't be expressed by composing primitives (like `quickPickFrameElement.ts`).
 */
export class HoverElement extends TUIElement {
    public maxWidth = HOVER_BOX_DEFAULT_MAX_WIDTH;
    public maxHeight = DEFAULT_MAX_HEIGHT;

    private blocksValue: readonly string[] = [];
    private readonly wrapped = new WidthKeyedCache((textWidth) => this.wrap(textWidth));

    public constructor() {
        super();
        this.focusable = false;
    }

    public get isEmpty(): boolean {
        return this.blocksValue.length === 0;
    }

    public setBlocks(blocks: readonly string[]): void {
        this.blocksValue = blocks.filter((block) => block.trim() !== "");
        this.wrapped.clear();
        // Stryker disable next-line CallExpression: marking for repaint is unobservable in a unit test (the snapshot renders the tree afresh); the app frame checks that path
        this.markDirty();
    }

    public linesFor(textWidth: number): readonly string[] {
        return this.wrapped.get(textWidth).lines;
    }

    private wrap(textWidth: number): IWrappedLines {
        const lines: string[] = [];
        const separators = new Set<number>();
        for (const [index, block] of this.blocksValue.entries()) {
            if (index > 0) {
                separators.add(lines.length);
                lines.push("─".repeat(Math.max(0, textWidth)));
            }
            lines.push(...wrapText(block, textWidth));
        }
        return { lines, separators };
    }

    private get boxSize(): Size {
        const textWidth = this.isEmpty ? null : hoverTextWidth(this.blocksValue.map(naturalWidth), this.maxWidth);
        return hoverBoxSize(textWidth, (width) => this.linesFor(width).length, this.maxHeight);
    }

    public override getMinIntrinsicWidth(_height: number): number {
        return this.boxSize.width;
    }

    public override getMaxIntrinsicWidth(_height: number): number {
        return this.boxSize.width;
    }

    public override getMinIntrinsicHeight(_width: number): number {
        return this.boxSize.height;
    }

    public override getMaxIntrinsicHeight(_width: number): number {
        return this.boxSize.height;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = constraints.constrain(this.boxSize);
        super.performLayout(BoxConstraints.tight(size));
        return size;
    }

    public override render(context: RenderContext): void {
        // Stryker disable next-line ConditionalExpression: an empty popup lays out to 0×0, so the size gate below cuts it off too; this exit only names the reason
        if (this.isEmpty) return;
        const w = this.layoutSize.width;
        const h = this.layoutSize.height;
        /* v8 ignore start -- defensive: a non-empty element never lays out to zero */
        // Stryker disable next-line ConditionalExpression,EqualityOperator,LogicalOperator: the branch is unreachable, see the v8 ignore above
        if (w <= 0 || h <= 0) return;
        /* v8 ignore stop */

        const border = this.styleVar("editorHoverWidget.border");
        const background = this.styleVar("editorHoverWidget.background");
        context.drawBox(0, 0, w, h, { fg: border, bg: background, fill: true });

        const textWidth = hoverTextWidthIn(w);
        const { lines, separators } = this.wrapped.get(textWidth);
        const visible = hoverVisibleLineCount(lines.length, h);
        for (let i = 0; i < visible; i++) {
            context.drawText(
                HOVER_BOX_TEXT_X,
                BORDER_THICKNESS + i,
                lines[i],
                {
                    fg: separators.has(i) ? border : this.styleVar("editorHoverWidget.foreground"),
                    bg: background,
                },
                // Stryker disable next-line ObjectLiteral: lines are already wrapped to textWidth, so truncation is unreachable; the limit is a safeguard for the drawText contract
                { maxWidth: textWidth },
            );
        }
    }
}
