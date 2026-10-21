import { createRange, type IRange } from "../../common/core/iRange.ts";
import type { ITextDocument } from "../../common/model/iTextDocument.ts";

// Like upstream `strings.firstNonWhitespaceIndex`: whitespace is only space and tab.

/** `-1` if the line is empty or all whitespace. */
export function firstNonWhitespaceIndex(line: string): number {
    return line.search(/[^ \t]/);
}

/** 0 for an all-whitespace line. */
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
