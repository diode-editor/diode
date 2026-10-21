import type { CharacterPair } from "../../../platform/extensions/common/iLanguageConfiguration.ts";
import type { IPosition } from "../../common/core/iPosition.ts";
import { createRange, type IRange } from "../../common/core/iRange.ts";
import { isWordChar } from "../../common/core/wordClassification.ts";
import type { ITextDocument } from "../../common/model/iTextDocument.ts";

import { firstNonWhitespaceIndex } from "./lineText.ts";

/** Brackets inside literals and comments don't form pairs. */
export type IsCodeAt = (line: number, character: number) => boolean;

/** `key` is the pair's opening bracket. */
interface IBracketHit {
    readonly line: number;
    readonly start: number;
    readonly end: number;
    readonly isOpen: boolean;
    readonly key: string;
}

/**
 * Upstream `smartSelect/browser/bracketSelections.ts`. Deviations: brackets are the
 * language configuration `brackets` pairs found in the text (not the tokenizer's
 * `model.bracketPairs`); there is no 30 ms per-round budget — the scan is linear and runs
 * on command, not on every keystroke.
 */
export function provideBracketSelectionRanges(
    document: ITextDocument,
    positions: readonly IPosition[],
    brackets: readonly CharacterPair[],
    isCodeAt: IsCodeAt = () => true,
): IRange[][] {
    const scanner = new BracketScanner(document, brackets, isCodeAt);
    return positions.map((position) => {
        const bucket: IRange[] = [];
        const closings = collectUnmatchedClosings(scanner, position);
        pairUnmatchedOpenings(scanner, position, closings, (open, close) => {
            const outer = createRange(open.line, open.start, close.line, close.end);
            bucket.push(createRange(open.line, open.end, close.line, close.start), outer);
            addBracketLeading(document, outer, bucket);
        });
        return bucket;
    });
}

/** `_bracketsRightYield`: per-key queue of unmatched closing brackets, nearest first. */
function collectUnmatchedClosings(scanner: BracketScanner, position: IPosition): Map<string, IBracketHit[]> {
    const closings = new Map<string, IBracketHit[]>();
    const depth = new Map<string, number>();
    for (let line = position.line; line < scanner.lineCount; line++) {
        for (const hit of scanner.hitsOnLine(line)) {
            if (line === position.line && hit.start < position.character) continue;
            const open = depth.get(hit.key) ?? 0;
            if (hit.isOpen) {
                depth.set(hit.key, open + 1);
            } else if (open > 0) {
                depth.set(hit.key, open - 1);
            } else {
                const queue = closings.get(hit.key) ?? [];
                queue.push(hit);
                closings.set(hit.key, queue);
            }
        }
    }
    return closings;
}

/** `_bracketsLeftYield`. */
function pairUnmatchedOpenings(
    scanner: BracketScanner,
    position: IPosition,
    closings: Map<string, IBracketHit[]>,
    onPair: (open: IBracketHit, close: IBracketHit) => void,
): void {
    const depth = new Map<string, number>();
    for (let line = position.line; line >= 0; line--) {
        const hits = scanner.hitsOnLine(line);
        for (let i = hits.length - 1; i >= 0; i--) {
            const hit = hits[i];
            if (line === position.line && hit.end > position.character) continue;
            const closed = depth.get(hit.key) ?? 0;
            if (!hit.isOpen) {
                depth.set(hit.key, closed + 1);
            } else if (closed > 0) {
                depth.set(hit.key, closed - 1);
            } else {
                const close = closings.get(hit.key)?.shift();
                if (close !== undefined) onPair(hit, close);
            }
        }
    }
}

/**
 * Multi-line pair with a "header" (upstream `_addBracketLeading`):
 *
 * ```
 * xxxxxxxx {      ← from the first non-whitespace char and from the line start
 * }
 *
 * xxxxxxxx        ← bracket on its own line below a header in the same column
 * {
 * }
 * ```
 */
function addBracketLeading(document: ITextDocument, bracket: IRange, bucket: IRange[]): void {
    if (bracket.start.line === bracket.end.line) return;
    const { end } = bracket;
    const startLine = bracket.start.line;
    const first = firstNonWhitespaceIndex(document.getLineContent(startLine));
    // The bracket's line is not blank, so `first` always exists.
    if (first !== bracket.start.character) {
        bucket.push(createRange(startLine, first, end.line, end.character));
        bucket.push(createRange(startLine, 0, end.line, end.character));
    }

    const aboveLine = startLine - 1;
    if (aboveLine >= 0) {
        const aboveFirst = firstNonWhitespaceIndex(document.getLineContent(aboveLine));
        if (aboveFirst === bracket.start.character) {
            bucket.push(createRange(aboveLine, aboveFirst, end.line, end.character));
            bucket.push(createRange(aboveLine, 0, end.line, end.character));
        }
    }
}

/** Per-request cache: cursors scan the same lines. */
class BracketScanner {
    /** Brackets, longest first: `[[` must not split into two `[`. */
    private readonly candidates: readonly { readonly text: string; readonly isOpen: boolean; readonly key: string }[];
    private readonly cache = new Map<number, readonly IBracketHit[]>();

    public constructor(
        private readonly document: ITextDocument,
        brackets: readonly CharacterPair[],
        private readonly isCodeAt: IsCodeAt,
    ) {
        const candidates: { text: string; isOpen: boolean; key: string }[] = [];
        for (const [open, close] of brackets) {
            // An empty "bracket" would loop the scan forever. A symmetric one (`|`) isn't filtered:
            // the opening always matches first, so there will be no closings.
            if (open === "" || close === "") continue;
            candidates.push({ text: open, isOpen: true, key: open });
            candidates.push({ text: close, isOpen: false, key: open });
        }
        this.candidates = candidates.sort((a, b) => b.text.length - a.text.length);
    }

    public get lineCount(): number {
        return this.document.lineCount;
    }

    public hitsOnLine(line: number): readonly IBracketHit[] {
        // Stryker disable all: the cache is only for speed, the result is the same with or without it
        let hits = this.cache.get(line);
        if (hits === undefined) {
            hits = this.scanLine(line);
            this.cache.set(line, hits);
        }
        // Stryker restore all
        return hits;
    }

    private scanLine(line: number): IBracketHit[] {
        const text = this.document.getLineContent(line);
        // Stryker disable next-line ArrayDeclaration: a foreign element is a "bracket" with no key or position, it pairs with nothing
        const hits: IBracketHit[] = [];
        let i = 0;
        // Stryker disable next-line EqualityOperator: no non-empty bracket matches at i === length — the extra step adds nothing
        while (i < text.length) {
            const found = this.candidates.find((c) => text.startsWith(c.text, i) && isWholeBracket(text, i, c.text));
            if (found === undefined) {
                i++;
                continue;
            }
            const end = i + found.text.length;
            if (this.isCodeAt(line, i)) hits.push({ line, start: i, end, isOpen: found.isOpen, key: found.key });
            i = end;
        }
        return hits;
    }
}

/**
 * A word bracket (`begin`/`end`) matches only as a whole word: `endless` is not a bracket.
 * Punctuation brackets match anywhere.
 */
function isWholeBracket(text: string, start: number, bracket: string): boolean {
    const end = start + bracket.length;
    if (isWordChar(bracket[0]) && start > 0 && isWordChar(text[start - 1])) return false;
    return !(isWordChar(bracket[bracket.length - 1]) && end < text.length && isWordChar(text[end]));
}
