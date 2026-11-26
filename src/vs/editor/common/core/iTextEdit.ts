import { comparePositions } from "./iPosition.ts";
import type { IRange } from "./iRange.ts";
import { createRange } from "./iRange.ts";

export interface ITextEdit {
    readonly range: IRange;
    readonly text: string;
}

export function createTextEdit(range: IRange, text: string): ITextEdit {
    return { range, text };
}

export function createInsertEdit(line: number, character: number, text: string): ITextEdit {
    return {
        range: createRange(line, character, line, character),
        text,
    };
}

export function createDeleteEdit(
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number,
): ITextEdit {
    return {
        range: createRange(startLine, startCharacter, endLine, endCharacter),
        text: "",
    };
}

/**
 * `ITextDocument.applyEdits` returns inverse edits in this order: whoever zips their
 * edits with the inverse ones sorts with this same comparator.
 */
export function compareTextEditsInDocumentOrder(a: ITextEdit, b: ITextEdit): number {
    const cmp = comparePositions(a.range.start, b.range.start);
    if (cmp !== 0) return cmp;
    return comparePositions(a.range.end, b.range.end);
}

/**
 * `ITextDocument.applyEdits` would apply overlapping edits to already consumed text:
 * silent corruption and broken undo. A batch from an untrusted source is rejected
 * whole, like `Overlapping ranges are not allowed` in vscode. Touching ranges and
 * zero-width inserts at the same point do NOT count as overlapping.
 */
export function hasOverlappingEdits(edits: readonly ITextEdit[]): boolean {
    // By end too: an insertion at the start of a deletion touches it whichever way round the batch lists them.
    const sorted = [...edits].sort(compareTextEditsInDocumentOrder);
    for (let i = 1; i < sorted.length; i++) {
        if (comparePositions(sorted[i].range.start, sorted[i - 1].range.end) < 0) return true;
    }
    return false;
}
