import { DisplayLine } from "@tuidom/core/common/displayLine";
import { Size } from "@tuidom/core/common/geometryPromitives";
import { BORDER_THICKNESS } from "@tuidom/core/dom/borderStyle";

// [│(0)][pad(1)][text…][pad(w-2)][│(w-1)]: the CompletionDetailsElement layout, shared by the hover and parameter hints.
export const HOVER_BOX_TEXT_X = 2;
const RIGHT_PAD = 1;
const MIN_WIDTH = 20;
export const HOVER_BOX_DEFAULT_MAX_WIDTH = 70;
const CHROME_WIDTH = HOVER_BOX_TEXT_X + RIGHT_PAD + BORDER_THICKNESS;

/** The text column follows the widest line, between the minimum box and `maxWidth`. */
export function hoverTextWidth(naturalWidths: readonly number[], maxWidth: number): number {
    return Math.min(Math.max(...naturalWidths, MIN_WIDTH - CHROME_WIDTH), maxWidth - CHROME_WIDTH);
}

export function hoverTextWidthIn(boxWidth: number): number {
    return Math.max(0, boxWidth - CHROME_WIDTH);
}

/** An empty popup (`textWidth === null`) lays out to 0×0. */
export function hoverBoxSize(
    textWidth: number | null,
    lineCount: (textWidth: number) => number,
    maxHeight: number,
): Size {
    if (textWidth === null) return new Size(0, 0);
    return new Size(textWidth + CHROME_WIDTH, Math.min(maxHeight, lineCount(textWidth) + BORDER_THICKNESS * 2));
}

export function hoverVisibleLineCount(lineCount: number, boxHeight: number): number {
    return Math.min(lineCount, Math.max(0, boxHeight - BORDER_THICKNESS * 2));
}

export function naturalWidth(text: string): number {
    let max = 0;
    for (const line of text.split("\n")) max = Math.max(max, new DisplayLine(line).displayWidth);
    return max;
}

/** Layout asks for the lines on every frame; they change only with the width or the content. */
export class WidthKeyedCache<T> {
    private entry: { width: number; value: T } | null = null;

    public constructor(private readonly compute: (width: number) => T) {}

    public get(width: number): T {
        // Stryker disable next-line ConditionalExpression,EqualityOperator,LogicalOperator,ObjectLiteral: a miss recomputes the same value, observable only by cost
        if (this.entry !== null && this.entry.width === width) return this.entry.value;
        const value = this.compute(width);
        // Stryker disable next-line ObjectLiteral: an empty entry is a permanent miss, see above
        this.entry = { width, value };
        return value;
    }

    public clear(): void {
        this.entry = null;
    }
}
