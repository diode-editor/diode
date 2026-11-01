import type { IInlineInsertion } from "../model/iInlineInsertion.ts";
import type { ITextDocument } from "../model/iTextDocument.ts";

// Counterpart of upstream `modelLineProjectionData.ts` injection math (`injectionOffsets`,
// `translateToInputOffset`, `translateToOutputPosition`): offsets of a document line vs. offsets
// of its COMPOSED line, the one with insertions spliced in. Deviation: upstream keeps it in the
// line projection; here the view composes lines itself, and wrap measures the composed line and
// reports document offsets (`computeComposedLineBreakOffsets`).

/**
 * The frame's {@link IInlineInsertion}s by document line, built per frame by
 * {@link groupLineInsertions}: painting and all overlay passes compute columns from the same
 * composed line, otherwise highlighting of the tail drifts away from the tail itself.
 */
export type LineInsertions = ReadonlyMap<number, readonly IInlineInsertion[]>;

export const NO_LINE_INSERTIONS: LineInsertions = new Map();

const NO_INSERTIONS: readonly IInlineInsertion[] = [];

/**
 * Sorted by offset, ties in the order given. Insertions may be stale (an edit landed before the
 * owner recomputed them): all composed-line math relies on "an insertion lies within its line",
 * so offsets are clamped into the line and insertions on missing lines are dropped.
 */
export function groupLineInsertions(
    document: Pick<ITextDocument, "lineCount" | "getLineLength">,
    insertions: readonly IInlineInsertion[],
): LineInsertions {
    const byLine = new Map<number, IInlineInsertion[]>();
    for (const insertion of insertions) {
        if (insertion.line < 0 || insertion.line >= document.lineCount) continue;
        const offset = Math.max(0, Math.min(insertion.offset, document.getLineLength(insertion.line)));
        let line = byLine.get(insertion.line);
        if (line === undefined) {
            line = [];
            byLine.set(insertion.line, line);
        }
        line.push(offset === insertion.offset ? insertion : { ...insertion, offset });
    }
    for (const line of byLine.values()) line.sort((a, b) => a.offset - b.offset);
    return byLine;
}

export function composedLineContent(insertions: LineInsertions, line: number, lineContent: string): string {
    const list = insertions.get(line);
    if (list === undefined) return lineContent;
    let composed = "";
    let from = 0;
    for (const insertion of list) {
        composed += lineContent.slice(from, insertion.offset) + insertion.text;
        from = insertion.offset;
    }
    return composed + lineContent.slice(from);
}

/** CHARACTER offset: the character at an insertion point moves right along with the tail. */
export function composedOffset(insertions: LineInsertions, line: number, offset: number): number {
    let composed = offset;
    for (const insertion of insertions.get(line) ?? NO_INSERTIONS) {
        if (insertion.offset > offset) break;
        composed += insertion.text.length;
    }
    return composed;
}

/**
 * Where a wrap fragment starting at document offset `start` starts on the composed line.
 * Insertions at a fragment boundary end the previous fragment, so a continuation starts after
 * them; the first fragment has no previous one and starts at 0, before an insertion there.
 */
export function composedFragmentStart(insertions: LineInsertions, line: number, start: number): number {
    return start === 0 ? 0 : composedOffset(insertions, line, start);
}

/**
 * INSERTION POINT offset: unlike {@link composedOffset}, a point exactly at an insertion point
 * stays LEFT of the insertions there (upstream injected-text affinity). Used for the exclusive end
 * of a range, which never covers the insertions at its end.
 */
export function composedInsertionPointOffset(insertions: LineInsertions, line: number, offset: number): number {
    let composed = offset;
    for (const insertion of insertions.get(line) ?? NO_INSERTIONS) {
        if (insertion.offset >= offset) break;
        composed += insertion.text.length;
    }
    return composed;
}

/**
 * CARET offset: like {@link composedInsertionPointOffset}, but the caret passes the insertions at
 * its point up to the last one with {@link IInlineInsertion.caretSide} `"right"`, so it is drawn on
 * the character after a color swatch rather than on the swatch.
 */
export function composedCaretOffset(insertions: LineInsertions, line: number, offset: number): number {
    let composed = offset;
    let pending = 0;
    for (const insertion of insertions.get(line) ?? NO_INSERTIONS) {
        if (insertion.offset > offset) break;
        pending += insertion.text.length;
        if (insertion.offset < offset || insertion.caretSide === "right") {
            composed += pending;
            pending = 0;
        }
    }
    return composed;
}

/** A click on the cells of an insertion maps to its insertion point. */
export function documentOffset(insertions: LineInsertions, line: number, offset: number): number {
    let shift = 0;
    for (const insertion of insertions.get(line) ?? NO_INSERTIONS) {
        const end = insertion.offset + shift + insertion.text.length;
        // Exactly at `end` both branches yield `insertion.offset` (the character after the insertion,
        // or the next insertion at the same point), so the `<` -> `<=` mutant is equivalent.
        // Stryker disable next-line EqualityOperator: see above
        if (offset < end) return Math.min(insertion.offset, offset - shift);
        shift += insertion.text.length;
    }
    return offset - shift;
}
