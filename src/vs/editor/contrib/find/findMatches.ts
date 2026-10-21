import type { IRange } from "../../common/core/iRange.ts";
import { createRange } from "../../common/core/iRange.ts";
import { isWordChar } from "../../common/core/wordClassification.ts";
import type { ITextDocument } from "../../common/model/iTextDocument.ts";

export interface ITextMatchOptions {
    readonly matchCase: boolean;
    readonly wholeWord: boolean;
}

/** Построчно, без перекрытий. Пустой запрос не находит ничего — как в VS Code. */
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
            // Не `idx + 1` и у отбракованного совпадения: перекрытий потребители не ждут.
            from = idx + queryLen;
            if (options.wholeWord && !isWholeWordAt(content, idx, queryLen)) continue;
            matches.push(createRange(line, idx, line, idx + queryLen));
        }
    }

    return matches;
}

function isWholeWordAt(content: string, idx: number, length: number): boolean {
    // Stryker disable next-line StringLiteral: isWordChar отвечает false на всё, что не ровно один символ, поэтому любая непустая подмена ведёт себя как пустая строка
    const before = idx > 0 ? content[idx - 1] : "";
    // Stryker disable next-line StringLiteral: см. выше — подмена заглушки ненаблюдаема
    const after = idx + length < content.length ? content[idx + length] : "";
    return !isWordChar(before) && !isWordChar(after);
}

export function findMatches(document: ITextDocument, query: string): IRange[] {
    // Stryker disable next-line ObjectLiteral: findTextMatches читает поля как истинностные значения, и отсутствующее поле равносильно false
    return findTextMatches(document, query, { matchCase: false, wholeWord: false });
}
