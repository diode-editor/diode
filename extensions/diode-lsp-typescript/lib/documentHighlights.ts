/**
 * The stock `typescript-language-server` maps tsserver's `writtenReference` to Read and only `definition`, which
 * `documentHighlights` does not emit, to Write: `let x = 1` and `x = 2` come in the read color. Upstream
 * `typescript-language-features` (`convertDocumentHighlight`) tells them apart by `writtenReference`, so we ask
 * tsserver through the server's `typescript.tsserverRequest` and convert its answer the same way.
 */

export interface ITsserverHighlight {
    /** All 0-based, tsserver's are 1-based. */
    readonly startLine: number;
    readonly startCharacter: number;
    readonly endLine: number;
    readonly endCharacter: number;
    readonly isWrite: boolean;
}

interface ITsserverLocation {
    readonly line: number;
    readonly offset: number;
}

interface ITsserverHighlightResponse {
    readonly body?: readonly {
        readonly highlightSpans: readonly {
            readonly start: ITsserverLocation;
            readonly end: ITsserverLocation;
            readonly kind: string;
        }[];
    }[];
}

/** `undefined`: no answer from tsserver (no project yet, a failed request), the stock request decides. */
export function highlightsFromTsserver(response: unknown): readonly ITsserverHighlight[] | undefined {
    return (response as ITsserverHighlightResponse | null | undefined)?.body?.flatMap((item) =>
        item.highlightSpans.map((span) => ({
            startLine: span.start.line - 1,
            startCharacter: span.start.offset - 1,
            endLine: span.end.line - 1,
            endCharacter: span.end.offset - 1,
            isWrite: span.kind === "writtenReference",
        })),
    );
}
