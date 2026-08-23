import type { IRange } from "../../common/core/iRange.ts";
import { createRange } from "../../common/core/iRange.ts";
import { isWordChar } from "../../common/core/wordClassification.ts";
import type { ITextDocument } from "../../common/model/iTextDocument.ts";

/** Как сравнивать: регистр и границы слова (оси VS Code `Aa` и `\b`). */
export interface ITextMatchOptions {
    readonly matchCase: boolean;
    readonly wholeWord: boolean;
}

/**
 * Все вхождения `query` в документном порядке: построчно (простой запрос не пересекает
 * перевод строки), без перекрытий. Пустой запрос не находит ничего — как в VS Code;
 * запрос из пробелов пробелы находит.
 *
 * Один сканер на всех потребителей: подсветку find-виджета (`findMatches`), подсветку
 * вхождений слова под кареткой (`computeWordOccurrences`) и семейство «выделить следующее
 * вхождение». Оси регистра и границ слова параметризованы, чтобы третий вариант не стал
 * третьей копией цикла.
 */
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
            // Шаг сканера двигается и у отбракованного совпадения: `от idx + 1` дал бы
            // перекрывающиеся вхождения, которых потребители не ждут.
            from = idx + queryLen;
            if (options.wholeWord && !isWholeWordAt(content, idx, queryLen)) continue;
            matches.push(createRange(line, idx, line, idx + queryLen));
        }
    }

    return matches;
}

/** Совпадение не окружено символами слова (граница слова с обеих сторон). */
function isWholeWordAt(content: string, idx: number, length: number): boolean {
    const before = idx > 0 ? content[idx - 1] : "";
    const after = idx + length < content.length ? content[idx + length] : "";
    return !isWordChar(before) && !isWordChar(after);
}

/**
 * Вхождения подстроки без учёта регистра — поверхность find-виджета.
 * Тонкая обёртка над {@link findTextMatches}.
 */
export function findMatches(document: ITextDocument, query: string): IRange[] {
    return findTextMatches(document, query, { matchCase: false, wholeWord: false });
}
