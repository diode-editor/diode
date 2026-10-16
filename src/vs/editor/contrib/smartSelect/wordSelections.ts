import type { IPosition } from "../../common/core/iPosition.ts";
import { createRange, type IRange } from "../../common/core/iRange.ts";
import { DEFAULT_WORD_REGEXP, getWordAtText } from "../../common/core/wordHelper.ts";
import type { ITextDocument } from "../../common/model/iTextDocument.ts";

import { documentRange, isBlankLine } from "./lineText.ts";

/**
 * Диапазоны «по словам» (upstream `smartSelect/browser/wordSelections.ts`):
 * подслово (`foo` в `fooBar`/`foo_bar`), слово, строка из одних пробелов и весь
 * документ. Этот провайдер спрашивается всегда — даже когда есть языковые, —
 * поэтому выделение до документа есть у любого файла.
 */
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

const isLower = (ch: string | undefined): boolean => ch !== undefined && ch >= "a" && ch <= "z";
const isUpper = (ch: string | undefined): boolean => ch !== undefined && ch >= "A" && ch <= "Z";
const isSeparator = (ch: string | undefined): boolean => ch === "_" || ch === "-";

/**
 * Подслово слова `word` вокруг смещения `offset` (upstream `_addInWordRanges`):
 * границы — `_`/`-` и переход camelCase. Обход и его условия — дословно эталон,
 * включая асимметрию (`lastCh` переживает левый проход и открывает правый).
 */
function subwordAt(word: string, offset: number): { start: number; end: number } | null {
    let start = offset;
    let end = offset;
    let lastCh: string | undefined;

    // Левая граница.
    for (; start >= 0; start--) {
        const ch = word[start];
        if (start !== offset && isSeparator(ch)) break; // foo-bar ИЛИ foo_bar
        if (isLower(ch) && isUpper(lastCh)) break; // fooBar
        lastCh = ch;
    }
    start += 1;

    // Правая граница.
    for (; end < word.length; end++) {
        const ch = word[end];
        if (isUpper(ch) && isLower(lastCh)) break; // fooBar
        if (isSeparator(ch)) break; // foo-bar ИЛИ foo_bar
        lastCh = ch;
    }

    return start < end ? { start, end } : null;
}
