import { createRange, type IRange } from "../../common/core/iRange.ts";
import type { ITextDocument } from "../../common/model/iTextDocument.ts";

/**
 * Пробельные края строки — как upstream `getLineFirstNonWhitespaceColumn` /
 * `getLineLastNonWhitespaceColumn` (`strings.firstNonWhitespaceIndex`):
 * пробелом считаются только пробел и табуляция.
 */

/** Индекс первого непробельного символа; `-1` — строка пустая или из одних пробелов. */
export function firstNonWhitespaceIndex(line: string): number {
    return line.search(/[^ \t]/);
}

/** Индекс ПОСЛЕ последнего непробельного символа; у строки из одних пробелов — 0. */
export function lastNonWhitespaceEnd(line: string): number {
    return line.replace(/[ \t]+$/, "").length;
}

export function isBlankLine(line: string): boolean {
    return firstNonWhitespaceIndex(line) === -1;
}

/** Весь документ: от начала первой строки до конца последней. */
export function documentRange(document: ITextDocument): IRange {
    const last = document.lineCount - 1;
    return createRange(0, 0, last, document.getLineLength(last));
}
