import type { IPosition } from "../../common/core/iPosition.ts";
import type { IRange } from "../../common/core/iRange.ts";
import { findWordRangeAt } from "../../common/core/wordClassification.ts";
import type { ITextDocument } from "../../common/model/iTextDocument.ts";

import { findTextMatches } from "./findMatches.ts";

/**
 * VS Code's textual word highlighter (fallback without a document-highlight provider).
 * The caret just past a word's end is on that word, as in `getWordAtPosition`.
 */
export function computeWordOccurrences(document: ITextDocument, position: IPosition): IRange[] {
    if (position.line < 0 || position.line >= document.lineCount) return [];
    const line = document.getLineContent(position.line);
    const wordRange = findWordRangeAt(line, position.character);
    if (wordRange === null) return [];
    const word = line.slice(wordRange.start, wordRange.end);
    return findTextMatches(document, word, { matchCase: true, wholeWord: true });
}
