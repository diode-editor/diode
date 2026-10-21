import { DisplayLine } from "@tuidom/core/common/displayLine";

import { STOP_RENDERING_LINE_AFTER } from "./longLineRendering.ts";

/** Clamped here, at the only use site: a viewport of a couple of columns would yield degenerate fragments. */
export const MIN_WRAP_WIDTH = 8;

/**
 * `null` means the line fits entirely. Wraps AFTER a whitespace run (spaces stay at the end of the
 * fragment, as in upstream); a long word is cut at a grapheme boundary. Tabs and wide graphemes
 * are measured by {@link DisplayLine}, not a custom scanner. Simplification: no
 * `wordWrapBreakBefore/AfterCharacters`, the tail past {@link STOP_RENDERING_LINE_AFTER} is not wrapped.
 */
export function computeLineBreakOffsets(lineContent: string, tabSize: number, wrapWidth: number): number[] | null {
    const width = Math.max(MIN_WRAP_WIDTH, wrapWidth);
    const dl = new DisplayLine(lineContent, tabSize, STOP_RENDERING_LINE_AFTER);
    // Fast path is a pure optimization: without it a fitting line goes through the loop,
    // no slot overflows the width, and the result is the same null.
    // Stryker disable next-line ConditionalExpression,EqualityOperator: see above
    if (dl.displayWidth <= width) return null;

    const breaks: number[] = [];
    let fragStartCol = 0;
    // -1: no whitespace in the current fragment yet.
    let candidateOffset = -1;
    let candidateCol = 0;
    let col = 0;
    for (const slot of dl.slots) {
        const slotEnd = col + slot.displayWidth;
        if (slot.grapheme === " " || slot.grapheme === "\t") {
            candidateOffset = slot.offset + slot.length;
            candidateCol = slotEnd;
        } else {
            // A loop, not an if: after wrapping at the candidate the word may still not fit
            // the new fragment, so a hard cut follows.
            while (slotEnd - fragStartCol > width) {
                // Stryker disable next-line EqualityOperator: the candidate is never zero, the wrap goes AFTER a whitespace slot, i.e. offset >= 1
                if (candidateOffset >= 0) {
                    breaks.push(candidateOffset);
                    fragStartCol = candidateCol;
                    candidateOffset = -1;
                } else {
                    /* v8 ignore start -- infinite-loop guard: a non-whitespace grapheme wider than the whole width (width >= MIN_WRAP_WIDTH=8, graphemes <= 2 columns) is unreachable */
                    // Stryker disable next-line all: unreachable guard, see v8 ignore above
                    if (col === fragStartCol) break;
                    /* v8 ignore stop */
                    breaks.push(slot.offset);
                    fragStartCol = col;
                }
            }
        }
        col = slotEnd;
    }
    return breaks.length > 0 ? breaks : null;
}
