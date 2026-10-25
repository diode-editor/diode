import { createRange, type IRange } from "../core/iRange.ts";
import { StandardTokenType } from "../encodedTokenAttributes.ts";
import type { LineTokens } from "../tokens/lineTokens.ts";

/** The part of `DocumentTokenStore` the trim reads; lines are 0-based. */
export interface ITrimWhitespaceTokens {
    hasAccurateTokensForLine(line: number): boolean;
    getLineTokens(line: number): LineTokens | undefined;
}

/**
 * Upstream `trimTrailingWhitespace` (`trimTrailingWhitespaceCommand.ts`) without cursor protection:
 * diode has no auto save, so every caller is a manual action. Only `' '` and `'\t'` count, as
 * upstream `lastNonWhitespaceIndex`. With `trimInRegexAndStrings` off a line is skipped when its
 * tokens are not accurate (tokenization is not forced, like upstream) or the tail starts inside a
 * String/RegEx token; no `tokens` at all means no accurate tokens anywhere.
 */
export function trimTrailingWhitespaceRanges(
    lines: readonly string[],
    trimInRegexAndStrings: boolean,
    tokens: ITrimWhitespaceTokens | undefined,
): IRange[] {
    const ranges: IRange[] = [];
    for (let line = 0; line < lines.length; line++) {
        const content = lines[line];
        const start = trailingWhitespaceStart(content);
        if (start === content.length) continue;
        if (!trimInRegexAndStrings && !isCodeAt(tokens, line, start)) continue;
        ranges.push(createRange(line, start, line, content.length));
    }
    return ranges;
}

/** Offset where the run of trailing spaces/tabs begins; `content.length` when there is none. */
export function trailingWhitespaceStart(content: string): number {
    let start = content.length;
    while (start > 0 && isSpaceOrTab(content.charCodeAt(start - 1))) start--;
    return start;
}

function isCodeAt(tokens: ITrimWhitespaceTokens | undefined, line: number, offset: number): boolean {
    if (tokens?.hasAccurateTokensForLine(line) !== true) return false;
    const lineTokens = tokens.getLineTokens(line);
    if (lineTokens === undefined) return false;
    const type = lineTokens.getStandardTokenType(lineTokens.findTokenIndexAtOffset(offset));
    return type !== StandardTokenType.String && type !== StandardTokenType.RegEx;
}

const SPACE = 0x20;
const TAB = 0x09;

function isSpaceOrTab(code: number): boolean {
    return code === SPACE || code === TAB;
}
