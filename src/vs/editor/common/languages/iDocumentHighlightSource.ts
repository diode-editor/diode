import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IPosition } from "../core/iPosition.ts";
import type { IRange } from "../core/iRange.ts";

/** upstream `languages.DocumentHighlightKind`. */
export enum DocumentHighlightKind {
    Text = 0,
    Read = 1,
    Write = 2,
}

/** upstream `languages.DocumentHighlight`. */
export interface IDocumentHighlight {
    /** 0-based. */
    readonly range: IRange;
    readonly kind?: DocumentHighlightKind;
}

export interface IDocumentHighlightRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** The provider reads the text from its own synced copy of this version. */
    readonly versionId: number;
    /** 0-based. */
    readonly position: IPosition;
}

/**
 * upstream `languages.DocumentHighlightProvider`. `null` means the provider declined and the next one is
 * asked; an empty array is a valid answer: nothing to highlight here.
 */
export interface DocumentHighlightProvider {
    provideDocumentHighlights(
        request: IDocumentHighlightRequest,
        token: ICancellationToken,
    ): Promise<readonly IDocumentHighlight[] | null>;
}

/** The highlights of one query. Each list is sorted by position: the painters and the scrollbar rely on it. */
export interface IWordHighlightSet {
    readonly ranges: readonly IRange[];
    readonly text: readonly IRange[];
    readonly read: readonly IRange[];
    readonly write: readonly IRange[];
}

const NO_RANGES: readonly IRange[] = [];

export const EMPTY_WORD_HIGHLIGHT_SET: IWordHighlightSet = {
    ranges: NO_RANGES,
    text: NO_RANGES,
    read: NO_RANGES,
    write: NO_RANGES,
};

/** The textual fallback: `ranges` already sorted, and no copy of a set that may hold every word of a big file. */
export function textWordHighlightSet(ranges: readonly IRange[]): IWordHighlightSet {
    return { ranges, text: ranges, read: NO_RANGES, write: NO_RANGES };
}

/**
 * `highlights` sorted. Upstream `getHighlightDecorationOptions`: Write and Text have their own decoration,
 * Read and a highlight without a kind share the third.
 */
export function wordHighlightSetOf(highlights: readonly IDocumentHighlight[]): IWordHighlightSet {
    const text: IRange[] = [];
    const read: IRange[] = [];
    const write: IRange[] = [];
    for (const { range, kind } of highlights) {
        if (kind === DocumentHighlightKind.Write) write.push(range);
        else if (kind === DocumentHighlightKind.Text) text.push(range);
        else read.push(range);
    }
    return { ranges: highlights.map(({ range }) => range), text, read, write };
}
