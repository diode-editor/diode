import { comparePositions } from "./iPosition.ts";
import type { IRange } from "./iRange.ts";
import { createRange } from "./iRange.ts";

/**
 * Represents a single text edit operation.
 * Replaces text in `range` with `text`. Empty `text` = deletion. Empty range = insertion.
 */
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
 * Документный порядок правок батча: по началу, при равных началах — по концу.
 * Его держит `ITextDocument.applyEdits` (и в нём же отдаёт обратные правки),
 * поэтому кто зипует свои правки с обратными, сортирует тем же компаратором.
 */
export function compareTextEditsInDocumentOrder(a: ITextEdit, b: ITextEdit): number {
    const cmp = comparePositions(a.range.start, b.range.start);
    if (cmp !== 0) return cmp;
    return comparePositions(a.range.end, b.range.end);
}

/**
 * Есть ли в батче правки, чьи диапазоны пересекаются.
 *
 * Непересечение — условие контракта `ITextDocument.applyEdits`: он применяет
 * батч снизу вверх (координаты нижних правок не плывут) и считает обратные
 * правки по накопленному сдвигу. Перекрытые правки он применит по уже
 * съеденному тексту — тихая порча содержимого и сломанный undo. Поэтому батч из
 * ненадёжного источника (правки расширения) проверяется на входе и отбивается
 * целиком, как `Overlapping ranges are not allowed` в vscode.
 *
 * Стык (`конец предыдущей === начало следующей`) и несколько вставок нулевой
 * ширины в одну точку пересечением НЕ считаются — это законный батч.
 */
export function hasOverlappingEdits(edits: readonly ITextEdit[]): boolean {
    const sorted = [...edits].sort((a, b) => comparePositions(a.range.start, b.range.start));
    for (let i = 1; i < sorted.length; i++) {
        if (comparePositions(sorted[i].range.start, sorted[i - 1].range.end) < 0) return true;
    }
    return false;
}
