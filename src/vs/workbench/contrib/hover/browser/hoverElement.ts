import { DisplayLine } from "@tuidom/core/common/displayLine";
import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { BORDER_THICKNESS } from "@tuidom/core/dom/borderStyle";
import { RenderContext, TUIElement } from "@tuidom/core/dom/tuiElement";
import { wrapText } from "@tuidom/elements/completionlist/completionDetailsElement";

// [│(0)][pad(1)][text…][pad(w-2)][│(w-1)]: the CompletionDetailsElement layout.
const TEXT_X = 2;
const RIGHT_PAD = 1;
const MIN_WIDTH = 20;
const DEFAULT_MAX_WIDTH = 70;
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
    public maxWidth = DEFAULT_MAX_WIDTH;
    public maxHeight = DEFAULT_MAX_HEIGHT;

    private blocksValue: readonly string[] = [];
    private wrapCache: { width: number; wrapped: IWrappedLines } | null = null;

    public constructor() {
        super();
        this.focusable = false;
    }

    public get isEmpty(): boolean {
        return this.blocksValue.length === 0;
    }

    public setBlocks(blocks: readonly string[]): void {
        this.blocksValue = blocks.filter((block) => block.trim() !== "");
        this.wrapCache = null;
        // Stryker disable next-line CallExpression: marking for repaint is unobservable in a unit test (the snapshot renders the tree afresh); the app frame checks that path
        this.markDirty();
    }

    public linesFor(textWidth: number): readonly string[] {
        return this.wrappedFor(textWidth).lines;
    }

    private wrappedFor(textWidth: number): IWrappedLines {
        // Layout is called on every frame, hence the cache (and the Stryker disable below).
        // Stryker disable next-line ConditionalExpression,EqualityOperator,LogicalOperator,ObjectLiteral: a cache miss is just a redundant recompute with the same result, unobservable
        if (this.wrapCache !== null && this.wrapCache.width === textWidth) return this.wrapCache.wrapped;
        const lines: string[] = [];
        const separators = new Set<number>();
        for (const [index, block] of this.blocksValue.entries()) {
            if (index > 0) {
                separators.add(lines.length);
                lines.push("─".repeat(Math.max(0, textWidth)));
            }
            lines.push(...wrapText(block, textWidth));
        }
        const wrapped: IWrappedLines = { lines, separators };
        // Stryker disable next-line ObjectLiteral: an empty cache is a perpetual miss, see above
        this.wrapCache = { width: textWidth, wrapped };
        return wrapped;
    }

    private get textWidth(): number {
        const natural = Math.max(
            ...this.blocksValue.map(naturalWidth),
            MIN_WIDTH - TEXT_X - RIGHT_PAD - BORDER_THICKNESS,
        );
        return Math.min(natural, this.maxWidth - TEXT_X - RIGHT_PAD - BORDER_THICKNESS);
    }

    private get boxWidth(): number {
        if (this.isEmpty) return 0;
        return TEXT_X + this.textWidth + RIGHT_PAD + BORDER_THICKNESS;
    }

    private get boxHeight(): number {
        if (this.isEmpty) return 0;
        const lines = this.linesFor(this.textWidth).length;
        return Math.min(this.maxHeight, lines + BORDER_THICKNESS * 2);
    }

    public override getMinIntrinsicWidth(_height: number): number {
        return this.boxWidth;
    }

    public override getMaxIntrinsicWidth(_height: number): number {
        return this.boxWidth;
    }

    public override getMinIntrinsicHeight(_width: number): number {
        return this.boxHeight;
    }

    public override getMaxIntrinsicHeight(_width: number): number {
        return this.boxHeight;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = constraints.constrain(new Size(this.boxWidth, this.boxHeight));
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

        const textWidth = Math.max(0, w - TEXT_X - RIGHT_PAD - BORDER_THICKNESS);
        const { lines, separators } = this.wrappedFor(textWidth);
        const visible = Math.min(lines.length, Math.max(0, h - BORDER_THICKNESS * 2));
        for (let i = 0; i < visible; i++) {
            context.drawText(
                TEXT_X,
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

function naturalWidth(text: string): number {
    let max = 0;
    for (const line of text.split("\n")) max = Math.max(max, new DisplayLine(line).displayWidth);
    return max;
}
