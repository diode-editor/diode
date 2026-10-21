import { createRange, type IRange } from "../../common/core/iRange.ts";
import type { ITextDocument } from "../../common/model/iTextDocument.ts";

// Как upstream `strings.firstNonWhitespaceIndex`: пробел — только пробел и табуляция.

/** `-1` — строка пустая или из одних пробелов. */
export function firstNonWhitespaceIndex(line: string): number {
    return line.search(/[^ \t]/);
}

/** У строки из одних пробелов — 0. */
export function lastNonWhitespaceEnd(line: string): number {
    return line.replace(/[ \t]+$/, "").length;
}

export function isBlankLine(line: string): boolean {
    return firstNonWhitespaceIndex(line) === -1;
}

export function documentRange(document: ITextDocument): IRange {
    const last = document.lineCount - 1;
    return createRange(0, 0, last, document.getLineLength(last));
}
