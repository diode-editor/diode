import type { IPosition } from "../../common/core/iPosition.ts";
import { comparePositions } from "../../common/core/iPosition.ts";
import type { IRange } from "../../common/core/iRange.ts";
import { createRange } from "../../common/core/iRange.ts";
import { isWordChar } from "../../common/core/wordClassification.ts";
import type { ITextDocument } from "../../common/model/iTextDocument.ts";

/** Upstream `findModel.ts`: the find stops collecting here and the widget shows "19999+". */
export const MATCHES_LIMIT = 19999;

export interface ITextMatchOptions {
    readonly matchCase: boolean;
    readonly wholeWord: boolean;
}

/** The query prepared once for every line: the sync walk, the background one and the navigation share it. */
export interface IPreparedQuery {
    readonly needle: string;
    readonly length: number;
    readonly options: ITextMatchOptions;
}

export function prepareQuery(query: string, options: ITextMatchOptions): IPreparedQuery {
    return { needle: options.matchCase ? query : query.toLowerCase(), length: query.length, options };
}

/**
 * The matches of one line in order, appended to `out`, no overlaps. Returns `false` when `limit` stopped
 * the collection: the caller walks no further.
 */
export function appendLineMatches(
    line: number,
    content: string,
    query: IPreparedQuery,
    out: IRange[],
    limit = MATCHES_LIMIT,
): boolean {
    const { needle, length, options } = query;
    const haystack = options.matchCase ? content : content.toLowerCase();
    let from = 0;
    for (;;) {
        const idx = haystack.indexOf(needle, from);
        if (idx === -1) return true;
        // Not `idx + 1` even for a rejected match: consumers don't expect overlaps.
        from = idx + length;
        if (options.wholeWord && !isWholeWordAt(content, idx, length)) continue;
        out.push(createRange(line, idx, line, idx + length));
        if (out.length >= limit) return false;
    }
}

/**
 * Line by line, no overlaps. An empty query finds nothing, as in VS Code. At most {@link MATCHES_LIMIT} matches:
 * on a document on disk every line may match, and 21 M ranges do not fit in memory.
 */
export function findTextMatches(document: ITextDocument, query: string, options: ITextMatchOptions): IRange[] {
    if (query.length === 0) return [];

    const prepared = prepareQuery(query, options);
    const matches: IRange[] = [];

    for (let line = 0; line < document.lineCount; line++) {
        if (!appendLineMatches(line, document.getLineContent(line), prepared, matches)) break;
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

/**
 * The first match that starts at `after` or later, wrapping around the end of the document (upstream
 * `findNextMatch`): how Next moves once the collection stopped at {@link MATCHES_LIMIT} and the list does not
 * hold the whole document. Walks the lines until the first hit; `null` when the document has none.
 */
export function findNextMatch(
    document: ITextDocument,
    after: IPosition,
    query: string,
    options: ITextMatchOptions,
): IRange | null {
    if (query.length === 0) return null;
    const prepared = prepareQuery(query, options);
    const lineCount = document.lineCount;
    // One extra step: the wrap comes back to the start line, whose matches before `after` were skipped.
    for (let step = 0; step <= lineCount; step++) {
        // A line out of range throws (getLineContent asserts it) instead of walking forever.
        const line = (after.line + step) % lineCount;
        const matches: IRange[] = [];
        appendLineMatches(line, document.getLineContent(line), prepared, matches);
        const first = step === 0 ? matches.find((match) => comparePositions(match.start, after) >= 0) : matches[0];
        if (first !== undefined) return first;
    }
    return null;
}

/** The last match that ends at `before` or earlier, wrapping around the start (upstream `findPreviousMatch`). */
export function findPreviousMatch(
    document: ITextDocument,
    before: IPosition,
    query: string,
    options: ITextMatchOptions,
): IRange | null {
    if (query.length === 0) return null;
    const prepared = prepareQuery(query, options);
    const lineCount = document.lineCount;
    for (let step = 0; step <= lineCount; step++) {
        const line = (before.line - step + lineCount * 2) % lineCount;
        const matches: IRange[] = [];
        appendLineMatches(line, document.getLineContent(line), prepared, matches);
        const candidates = step === 0 ? matches.filter((match) => comparePositions(match.end, before) <= 0) : matches;
        if (candidates.length > 0) return candidates[candidates.length - 1];
    }
    return null;
}
