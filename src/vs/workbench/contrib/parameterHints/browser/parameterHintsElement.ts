import { DisplayLine } from "@tuidom/core/common/displayLine";
import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { BORDER_THICKNESS } from "@tuidom/core/dom/borderStyle";
import { RenderContext, TUIElement } from "@tuidom/core/dom/tuiElement";
import { wrapText } from "@tuidom/elements/completionlist/completionDetailsElement";

import { type ISignatureChunk, wrapSignature } from "./signatureLayout.ts";

// [│(0)][pad(1)][text…][pad(w-2)][│(w-1)] — the HoverElement layout.
const TEXT_X = 2;
const RIGHT_PAD = 1;
const MIN_WIDTH = 20;
const DEFAULT_MAX_WIDTH = 70;
/** v1 height clamp: long documentation is cut off; scrolling is a separate task. */
const DEFAULT_MAX_HEIGHT = 10;

export interface IParameterHint {
    readonly label: string;
    readonly activeSpan: readonly [number, number];
    /** `null` when there is a single signature. */
    readonly counter: string | null;
    /** Plain text without markdown. */
    readonly documentation: readonly string[];
}

interface IHintLine {
    readonly text: string;
    /** Offset in the signature label that `text[prefixLength]` maps to; `null` means not a label line. */
    readonly labelStart: number | null;
    /** How many leading characters of the line are the counter/indent rather than the label. */
    readonly prefixLength: number;
    readonly separator: boolean;
}

/**
 * Not in tuidom: per-character highlighting over drawBox cannot be expressed by composing primitives
 * (modeled on `HoverElement`).
 */
export class ParameterHintsElement extends TUIElement {
    /** The actual width follows the longest line. */
    public maxWidth = DEFAULT_MAX_WIDTH;
    public maxHeight = DEFAULT_MAX_HEIGHT;

    private hintValue: IParameterHint | null = null;
    /** Layout is called on every frame. */
    private linesCache: { width: number; lines: readonly IHintLine[] } | null = null;

    public constructor() {
        super();
        this.focusable = false;
    }

    public get isEmpty(): boolean {
        return this.hintValue === null;
    }

    public get hint(): IParameterHint | null {
        return this.hintValue;
    }

    public setHint(hint: IParameterHint | null): void {
        this.hintValue = hint;
        this.linesCache = null;
        // Stryker disable next-line CallExpression: the repaint mark is not observable in a unit test (the snapshot re-renders the tree); the app frame covers its path
        this.markDirty();
    }

    public linesFor(textWidth: number): readonly string[] {
        return this.layoutFor(textWidth).map((line) => line.text);
    }

    private labelIndentFor(hint: IParameterHint): number {
        return hint.counter === null ? 0 : hint.counter.length + 1;
    }

    private layoutFor(textWidth: number): readonly IHintLine[] {
        // A cache miss costs a recomputation but gives the same result — observable only
        // by cost (hence the Stryker disable below).
        // Stryker disable next-line ConditionalExpression,EqualityOperator,LogicalOperator,ObjectLiteral: a cache miss is an extra recomputation with the same result, not observable
        if (this.linesCache !== null && this.linesCache.width === textWidth) return this.linesCache.lines;
        const lines = this.buildLines(textWidth);
        // Stryker disable next-line ObjectLiteral: an empty cache is a permanent miss, see above
        this.linesCache = { width: textWidth, lines };
        return lines;
    }

    private buildLines(textWidth: number): readonly IHintLine[] {
        const hint = this.hintValue;
        if (hint === null) return [];
        const lines: IHintLine[] = [];
        const indent = this.labelIndentFor(hint);
        const chunks: readonly ISignatureChunk[] = wrapSignature(hint.label, Math.max(1, textWidth - indent));
        for (const [index, chunk] of chunks.entries()) {
            // The counter is drawn separately, so it is not part of the label line —
            // but its indent is the same on all wrapped lines.
            const prefix = index === 0 && hint.counter !== null ? hint.counter + " " : " ".repeat(indent);
            lines.push({
                text: prefix + chunk.text,
                labelStart: chunk.start,
                prefixLength: prefix.length,
                separator: false,
            });
        }
        for (const block of hint.documentation) {
            const wrapped = wrapText(block, textWidth).filter((text) => text !== "");
            if (wrapped.length === 0) continue;
            lines.push({ text: "", labelStart: null, prefixLength: 0, separator: true });
            for (const text of wrapped) lines.push({ text, labelStart: null, prefixLength: 0, separator: false });
        }
        return lines;
    }

    private textWidthFor(hint: IParameterHint): number {
        const natural = Math.max(
            naturalWidth(hint.label) + this.labelIndentFor(hint),
            ...hint.documentation.map(naturalWidth),
            MIN_WIDTH - TEXT_X - RIGHT_PAD - BORDER_THICKNESS,
        );
        return Math.min(natural, this.maxWidth - TEXT_X - RIGHT_PAD - BORDER_THICKNESS);
    }

    private get boxWidth(): number {
        const hint = this.hintValue;
        if (hint === null) return 0;
        return TEXT_X + this.textWidthFor(hint) + RIGHT_PAD + BORDER_THICKNESS;
    }

    private get boxHeight(): number {
        const hint = this.hintValue;
        if (hint === null) return 0;
        const lines = this.layoutFor(this.textWidthFor(hint)).length;
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
        const hint = this.hintValue;
        // Stryker disable next-line ConditionalExpression: an empty popup lays out to 0×0, so the size gate below cuts it off too — this exit only names the reason
        if (hint === null) return;
        const w = this.layoutSize.width;
        const h = this.layoutSize.height;
        /* v8 ignore start -- defensive: a non-empty element never lays out to zero */
        // Stryker disable next-line ConditionalExpression,EqualityOperator,LogicalOperator: the branch is unreachable — see v8 ignore above
        if (w <= 0 || h <= 0) return;
        /* v8 ignore stop */

        const border = this.styleVar("editorHoverWidget.border");
        const background = this.styleVar("editorHoverWidget.background");
        const foreground = this.styleVar("editorHoverWidget.foreground");
        const highlight = this.styleVar("editorHoverWidget.highlightForeground");
        context.drawBox(0, 0, w, h, { fg: border, bg: background, fill: true });

        const textWidth = Math.max(0, w - TEXT_X - RIGHT_PAD - BORDER_THICKNESS);
        const lines = this.layoutFor(textWidth);
        const visible = Math.min(lines.length, Math.max(0, h - BORDER_THICKNESS * 2));
        const [spanStart, spanEnd] = hint.activeSpan;
        for (let i = 0; i < visible; i++) {
            const line = lines[i];
            const y = BORDER_THICKNESS + i;
            if (line.separator) {
                // Stryker disable next-line ObjectLiteral: drawBox already filled the interior with the box colors, so the explicit style matches the inherited one — it is there to not depend on the fill
                context.drawText(TEXT_X, y, "─".repeat(textWidth), { fg: border, bg: background });
                continue;
            }
            const labelStart = line.labelStart;
            context.drawText(
                TEXT_X,
                y,
                line.text,
                { fg: foreground, bg: background },
                {
                    // Stryker disable next-line ObjectLiteral: lines are already wrapped to textWidth — clipping is unreachable, the limit is a safeguard for the drawText contract
                    maxWidth: textWidth,
                    ...(labelStart === null
                        ? {}
                        : {
                              getStyle: (offset: number) => {
                                  // The counter and wrap indent are not the label: their offsets
                                  // would fall into the parameter range and highlight nothing.
                                  if (offset < line.prefixLength) return undefined;
                                  const inLabel = labelStart + offset - line.prefixLength;
                                  if (inLabel < spanStart || inLabel >= spanEnd) return undefined;
                                  return { fg: highlight, bg: background, style: StyleFlags.Bold };
                              },
                          }),
                },
            );
        }
    }
}

function naturalWidth(text: string): number {
    let max = 0;
    for (const line of text.split("\n")) max = Math.max(max, new DisplayLine(line).displayWidth);
    return max;
}
