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
 * В этом порядке `ITextDocument.applyEdits` отдаёт обратные правки — кто зипует
 * свои правки с обратными, сортирует тем же компаратором.
 */
export function compareTextEditsInDocumentOrder(a: ITextEdit, b: ITextEdit): number {
    const cmp = comparePositions(a.range.start, b.range.start);
    if (cmp !== 0) return cmp;
    return comparePositions(a.range.end, b.range.end);
}

/**
 * Перекрытые правки `ITextDocument.applyEdits` применил бы по уже съеденному
 * тексту — тихая порча и сломанный undo. Батч из ненадёжного источника
 * отбивается целиком, как `Overlapping ranges are not allowed` в vscode. Стык
 * и вставки нулевой ширины в одну точку пересечением НЕ считаются.
 */
export function hasOverlappingEdits(edits: readonly ITextEdit[]): boolean {
    const sorted = [...edits].sort((a, b) => comparePositions(a.range.start, b.range.start));
    for (let i = 1; i < sorted.length; i++) {
        if (comparePositions(sorted[i].range.start, sorted[i - 1].range.end) < 0) return true;
    }
    return false;
}
