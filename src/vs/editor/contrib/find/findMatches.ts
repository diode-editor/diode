import type { IRange } from "../../common/core/iRange.ts";
import { createRange } from "../../common/core/iRange.ts";
import { isWordChar } from "../../common/core/wordClassification.ts";
import type { ITextDocument } from "../../common/model/iTextDocument.ts";

export interface ITextMatchOptions {
    readonly matchCase: boolean;
    readonly wholeWord: boolean;
}

/** Line by line, no overlaps. An empty query finds nothing, as in VS Code. */
export function findTextMatches(document: ITextDocument, query: string, options: ITextMatchOptions): IRange[] {
    if (query.length === 0) return [];

    const needle = options.matchCase ? query : query.toLowerCase();
    const queryLen = query.length;
    const matches: IRange[] = [];

    for (let line = 0; line < document.lineCount; line++) {
        const content = document.getLineContent(line);
        const haystack = options.matchCase ? content : content.toLowerCase();
        let from = 0;
        for (;;) {
            const idx = haystack.indexOf(needle, from);
            if (idx === -1) break;
            // Not `idx + 1` even for a rejected match: consumers don't expect overlaps.
            from = idx + queryLen;
            if (options.wholeWord && !isWholeWordAt(content, idx, queryLen)) continue;
            matches.push(createRange(line, idx, line, idx + queryLen));
        }
    }

    return matches;
}

function isWholeWordAt(content: string, idx: number, length: number): boolean {
    // Stryker disable next-line StringLiteral: isWordChar returns false for anything but exactly one char, so any non-empty replacement behaves like the empty string
    const before = idx > 0 ? content[idx - 1] : "";
    // Stryker disable next-line StringLiteral: see above — replacing the placeholder is unobservable
    const after = idx + length < content.length ? content[idx + length] : "";
    return !isWordChar(before) && !isWordChar(after);
}

export function findMatches(document: ITextDocument, query: string): IRange[] {
    // Stryker disable next-line ObjectLiteral: findTextMatches reads the fields as truthy values, and a missing field equals false
    return findTextMatches(document, query, { matchCase: false, wholeWord: false });
}
