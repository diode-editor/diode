import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
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
} from "../../hover/browser/hoverBox.ts";

import { type ISignatureChunk, wrapSignature } from "./signatureLayout.ts";

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
    public maxWidth = HOVER_BOX_DEFAULT_MAX_WIDTH;
    public maxHeight = DEFAULT_MAX_HEIGHT;

    private hintValue: IParameterHint | null = null;
    private readonly lines = new WidthKeyedCache((textWidth) => this.buildLines(textWidth));

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
        this.lines.clear();
        // Stryker disable next-line CallExpression: the repaint mark is not observable in a unit test (the snapshot re-renders the tree); the app frame covers its path
        this.markDirty();
    }

    public linesFor(textWidth: number): readonly string[] {
        return this.lines.get(textWidth).map((line) => line.text);
    }

    private labelIndentFor(hint: IParameterHint): number {
        return hint.counter === null ? 0 : hint.counter.length + 1;
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
        return hoverTextWidth(
            [naturalWidth(hint.label) + this.labelIndentFor(hint), ...hint.documentation.map(naturalWidth)],
            this.maxWidth,
        );
    }

    private get boxSize(): Size {
        const hint = this.hintValue;
        const textWidth = hint === null ? null : this.textWidthFor(hint);
        return hoverBoxSize(textWidth, (width) => this.lines.get(width).length, this.maxHeight);
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

        const textWidth = hoverTextWidthIn(w);
        const lines = this.lines.get(textWidth);
        const visible = hoverVisibleLineCount(lines.length, h);
        const [spanStart, spanEnd] = hint.activeSpan;
        for (let i = 0; i < visible; i++) {
            const line = lines[i];
            const y = BORDER_THICKNESS + i;
            if (line.separator) {
                // Stryker disable next-line ObjectLiteral: drawBox already filled the interior with the box colors, so the explicit style matches the inherited one — it is there to not depend on the fill
                context.drawText(HOVER_BOX_TEXT_X, y, "─".repeat(textWidth), { fg: border, bg: background });
                continue;
            }
            const labelStart = line.labelStart;
            context.drawText(
                HOVER_BOX_TEXT_X,
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
