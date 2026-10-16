import { createRange, type IRange } from "../../common/core/iRange.ts";
import type { ITextDocument } from "../../common/model/iTextDocument.ts";

/**
 * Пробельные края строки — как upstream `getLineFirstNonWhitespaceColumn` /
 * `getLineLastNonWhitespaceColumn` (`strings.firstNonWhitespaceIndex`):
 * пробелом считаются только пробел и табуляция.
 */
const isIndent = (ch: string): boolean => ch === " " || ch === "\t";

/** Индекс первого непробельного символа; `-1` — строка пустая или из одних пробелов. */
export function firstNonWhitespaceIndex(line: string): number {
    for (let i = 0; i < line.length; i++) {
        if (!isIndent(line[i])) return i;
    }
    return -1;
}

/** Индекс ПОСЛЕ последнего непробельного символа; `-1` — строка пустая или из одних пробелов. */
export function lastNonWhitespaceEnd(line: string): number {
    for (let i = line.length - 1; i >= 0; i--) {
        if (!isIndent(line[i])) return i + 1;
    }
    return -1;
}

export function isBlankLine(line: string): boolean {
    return firstNonWhitespaceIndex(line) === -1;
}

/** Весь документ: от начала первой строки до конца последней. */
export function documentRange(document: ITextDocument): IRange {
    const last = document.lineCount - 1;
    return createRange(0, 0, last, document.getLineLength(last));
}
