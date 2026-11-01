import { DisplayLine } from "@tuidom/core/common/displayLine";

import type { IInlineInsertion } from "../model/iInlineInsertion.ts";

import { composedLineContent } from "./lineInsertions.ts";
import { STOP_RENDERING_LINE_AFTER } from "./longLineRendering.ts";

/** Clamped here, at the only use site: a viewport of a couple of columns would yield degenerate fragments. */
export const MIN_WRAP_WIDTH = 8;

/**
 * `null` means the line fits entirely. Wraps AFTER a whitespace run (spaces stay at the end of the
 * fragment, as in upstream); a long word is cut at a grapheme boundary. Tabs and wide graphemes
 * are measured by {@link DisplayLine}, not a custom scanner. Simplification: no
 * `wordWrapBreakBefore/AfterCharacters`, the tail past {@link STOP_RENDERING_LINE_AFTER} is not wrapped.
 */
export function computeLineBreakOffsets(
    lineContent: string,
    tabSize: number,
    wrapWidth: number,
    canBreakAt: (offset: number) => boolean = () => true,
): number[] | null {
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
    // The last place a long word may be cut: the slot that overflows, unless a break is not allowed there.
    let cutOffset = 0;
    let cutCol = 0;
    let col = 0;
    for (const slot of dl.slots) {
        const slotEnd = col + slot.displayWidth;
        if (canBreakAt(slot.offset)) {
            cutOffset = slot.offset;
            cutCol = col;
        }
        if (slot.grapheme === " " || slot.grapheme === "\t") {
            if (canBreakAt(slot.offset + slot.length)) {
                candidateOffset = slot.offset + slot.length;
                candidateCol = slotEnd;
            }
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
                    // Nowhere to cut: an insertion wider than the width overflows the fragment.
                    if (cutCol <= fragStartCol) break;
                    breaks.push(cutOffset);
                    fragStartCol = cutCol;
                }
            }
        }
        col = slotEnd;
    }
    return breaks.length > 0 ? breaks : null;
}

/**
 * Upstream `monospaceLineBreaksComputer` measures injected text too. Offsets are of the document line. A fragment
 * boundary at an insertion point keeps the insertion on the fragment before it (`composedFragmentStart`), so a break
 * is allowed right after an insertion and neither inside nor right before it: there it would push the cells over.
 */
export function computeComposedLineBreakOffsets(
    lineContent: string,
    insertions: readonly IInlineInsertion[],
    tabSize: number,
    wrapWidth: number,
): number[] | null {
    let shift = 0;
    const ranges = insertions.map((insertion) => {
        const start = insertion.offset + shift;
        shift += insertion.text.length;
        // At the line start "right after" would be document offset 0: an empty first fragment.
        return { start, end: start + insertion.text.length + (insertion.offset === 0 ? 1 : 0) };
    });
    const breaks = computeLineBreakOffsets(
        composedLineContent(new Map([[0, insertions]]), 0, lineContent),
        tabSize,
        wrapWidth,
        (offset) => !ranges.some((range) => offset >= range.start && offset < range.end),
    );
    return (
        breaks?.map((offset) => {
            let inserted = 0;
            for (const insertion of insertions) {
                // Stryker disable next-line EqualityOperator: `canBreakAt` forbids a break exactly at an insertion start, and an empty insertion adds nothing, so `>` gives the same result
                if (insertion.offset + inserted >= offset) break;
                inserted += insertion.text.length;
            }
            return offset - inserted;
        }) ?? null
    );
}
