import { DisplayLine } from "@tuidom/core/common/displayLine";

import type { IInlineInsertion } from "../model/iInlineInsertion.ts";

import { STOP_RENDERING_LINE_AFTER } from "./longLineRendering.ts";

/** Clamped here, at the only use site: a viewport of a couple of columns would yield degenerate fragments. */
export const MIN_WRAP_WIDTH = 8;

/** What wrap needs of an insertion: sorted by offset, as {@link groupLineInsertions} gives them. */
export type WrapInsertion = Pick<IInlineInsertion, "offset" | "text">;

const NO_INSERTIONS: readonly WrapInsertion[] = [];

/**
 * `null` means the line fits entirely. Wraps AFTER a whitespace run (spaces stay at the end of the
 * fragment, as in upstream); a long word is cut at a grapheme boundary. Tabs and wide graphemes
 * are measured by {@link DisplayLine}, not a custom scanner. Simplification: no
 * `wordWrapBreakBefore/AfterCharacters`, the tail past {@link STOP_RENDERING_LINE_AFTER} is not wrapped.
 *
 * Measures the line with its insertions, as upstream's `createLineBreaks`, but returns DOCUMENT offsets. A fragment
 * starting at a document offset starts after the insertions there ({@link composedFragmentStart}), so insertions at a
 * boundary end the previous fragment. When an insertion is what overflows, the cut goes before the document character
 * ahead of it, taking the insertion along. An insertion wider than the width alone still overflows and is clipped.
 */
export function computeLineBreakOffsets(
    lineContent: string,
    tabSize: number,
    wrapWidth: number,
    insertions: readonly WrapInsertion[] = NO_INSERTIONS,
): number[] | null {
    const width = Math.max(MIN_WRAP_WIDTH, wrapWidth);
    const offsets = insertions.map((insertion) => Math.min(insertion.offset, lineContent.length));
    let composed = "";
    let from = 0;
    insertions.forEach((insertion, i) => {
        composed += lineContent.slice(from, offsets[i]) + insertion.text;
        from = offsets[i];
    });
    composed += lineContent.slice(from);
    const dl = new DisplayLine(composed, tabSize, STOP_RENDERING_LINE_AFTER);
    // Fast path is a pure optimization: without it a fitting line goes through the loop,
    // no slot overflows the width, and the result is the same null.
    // Stryker disable next-line ConditionalExpression,EqualityOperator: see above
    if (dl.displayWidth <= width) return null;

    const breaks: number[] = [];
    let lastBreak = 0;
    let fragStartCol = 0;
    // -1: no whitespace in the current fragment yet.
    let candidateOffset = -1;
    let candidateCol = 0;
    let afterWhitespace = false;
    let previousOffset = 0;
    let previousCol = 0;
    let col = 0;
    let next = 0;
    let shift = 0;
    for (const slot of dl.slots) {
        const slotEnd = col + slot.displayWidth;
        while (next < insertions.length && offsets[next] + shift + insertions[next].text.length <= slot.offset) {
            shift += insertions[next].text.length;
            next++;
        }
        // Stryker disable next-line ConditionalExpression,EqualityOperator: past the last insertion the sum is NaN and the comparison false anyway; the bound is for the reader
        const inserted = next < insertions.length && slot.offset >= offsets[next] + shift;
        const offset = slot.offset - shift;
        if (!inserted && (slot.grapheme === " " || slot.grapheme === "\t")) {
            afterWhitespace = true;
        } else {
            // The boundary is the next document character: the insertions after the whitespace stay on this fragment.
            if (!inserted && afterWhitespace) {
                candidateOffset = offset;
                candidateCol = col;
                afterWhitespace = false;
            }
            // A loop, not an if: after wrapping at the candidate the word may still not fit
            // the new fragment, so a hard cut follows.
            while (slotEnd - fragStartCol > width) {
                // Stryker disable next-line EqualityOperator: the candidate is never zero, the wrap goes AFTER a whitespace slot, i.e. offset >= 1
                if (candidateOffset >= 0) {
                    breaks.push(candidateOffset);
                    lastBreak = candidateOffset;
                    fragStartCol = candidateCol;
                    candidateOffset = -1;
                } else {
                    const cutOffset = inserted ? previousOffset : offset;
                    const cutCol = inserted ? previousCol : col;
                    // Nothing to cut at: this fragment starts here, or offset 0 is the first fragment's own start.
                    if (cutOffset <= lastBreak) break;
                    breaks.push(cutOffset);
                    lastBreak = cutOffset;
                    fragStartCol = cutCol;
                }
            }
        }
        if (!inserted) {
            previousOffset = offset;
            previousCol = col;
        }
        col = slotEnd;
    }
    return breaks.length > 0 ? breaks : null;
}
