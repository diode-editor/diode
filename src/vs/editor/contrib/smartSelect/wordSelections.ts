import type { IPosition } from "../../common/core/iPosition.ts";
import { createRange, type IRange } from "../../common/core/iRange.ts";
import { DEFAULT_WORD_REGEXP, getWordAtText } from "../../common/core/wordHelper.ts";
import type { ITextDocument } from "../../common/model/iTextDocument.ts";

import { documentRange, isBlankLine } from "./lineText.ts";

/** Upstream `smartSelect/browser/wordSelections.ts`. */
export function provideWordSelectionRanges(
    document: ITextDocument,
    positions: readonly IPosition[],
    selectSubwords: boolean,
): IRange[][] {
    return positions.map((position) => {
        const bucket: IRange[] = [];
        const line = document.getLineContent(position.line);
        const word = getWordAtText(position.character, DEFAULT_WORD_REGEXP, line);
        if (word !== null) {
            if (selectSubwords) {
                const subword = subwordAt(line.slice(word.start, word.end), position.character - word.start);
                if (subword !== null) {
                    bucket.push(
                        createRange(position.line, word.start + subword.start, position.line, word.start + subword.end),
                    );
                }
            }
            bucket.push(createRange(position.line, word.start, position.line, word.end));
        }
        if (line.length > 0 && isBlankLine(line)) {
            bucket.push(createRange(position.line, 0, position.line, line.length));
        }
        bucket.push(documentRange(document));
        return bucket;
    });
}

const isLower = (ch: string): boolean => ch >= "a" && ch <= "z";
const isUpper = (ch: string): boolean => ch >= "A" && ch <= "Z";
// Stryker disable next-line ConditionalExpression,StringLiteral: DEFAULT_WORD_REGEXP never puts `-` in a word — an upstream branch that is dead with our regex
const isSeparator = (ch: string): boolean => ch === "_" || ch === "-";

/**
 * Upstream `_addInWordRanges` verbatim, including its asymmetry (`lastCh` survives the
 * left pass and seeds the right one).
 */
function subwordAt(word: string, offset: number): { start: number; end: number } | null {
    let start = offset;
    let end = offset;
    let lastCh = "";

    for (; start >= 0; start--) {
        const ch = word.charAt(start);
        if (start !== offset && isSeparator(ch)) break; // foo-bar OR foo_bar
        if (isLower(ch) && isUpper(lastCh)) break; // fooBar
        lastCh = ch;
    }
    start += 1;

    for (; end < word.length; end++) {
        const ch = word.charAt(end);
        if (isUpper(ch) && isLower(lastCh)) break; // fooBar
        if (isSeparator(ch)) break; // foo-bar OR foo_bar
        lastCh = ch;
    }

    return start < end ? { start, end } : null;
}
