import { type IRelativePattern, matchGlob, matchRelativeGlob } from "../../base/common/glob.ts";
import type { Uri } from "../../base/common/uri.ts";

/**
 * upstream `languageSelector.ts` без `hasAccessToAllModels` и `isBuiltin`.
 * `notebookType` принимается, но ноутбуков нет — фильтр с ним не матчит ничего.
 */
export interface LanguageFilter {
    readonly language?: string;
    readonly scheme?: string;
    readonly pattern?: string | IRelativePattern;
    readonly notebookType?: string;
    readonly exclusive?: boolean;
}

export type LanguageSelector = string | LanguageFilter | readonly (string | LanguageFilter)[];

/**
 * 10 — точное совпадение, 5 — по `*`, 0 — не подходит. Параметра upstream
 * `candidateIsSynchronized` нет: хосту уходит любой документ.
 */
export function score(selector: LanguageSelector | undefined, candidateUri: Uri, candidateLanguage: string): number {
    if (isSelectorArray(selector)) {
        let ret = 0;
        for (const filter of selector) {
            const value = score(filter, candidateUri, candidateLanguage);
            // Stryker disable next-line ConditionalExpression,BlockStatement: ранний выход — оптимизация; без него цикл дойдёт до того же максимума
            if (value === 10) return value;
            ret = Math.max(ret, value);
        }
        return ret;
    }
    if (typeof selector === "string") {
        if (selector === "*") return 5;
        return selector === candidateLanguage ? 10 : 0;
    }
    if (selector === undefined) return 0;
    return scoreFilter(selector, candidateUri, candidateLanguage);
}

function isSelectorArray(selector: LanguageSelector | undefined): selector is readonly (string | LanguageFilter)[] {
    return Array.isArray(selector);
}

function scoreFilter(filter: LanguageFilter, candidateUri: Uri, candidateLanguage: string): number {
    const { language, pattern, scheme, notebookType } = filter;

    let ret = 0;

    // Пустые строки upstream трактует как «ограничения нет» (проверка на truthy).
    if (scheme !== undefined && scheme !== "") {
        if (scheme === candidateUri.scheme) {
            ret = 10;
        } else if (scheme === "*") {
            ret = 5;
        } else {
            return 0;
        }
    }

    if (language !== undefined && language !== "") {
        if (language === candidateLanguage) {
            ret = 10;
        } else if (language === "*") {
            ret = Math.max(ret, 5);
        } else {
            return 0;
        }
    }

    if (notebookType !== undefined && notebookType !== "") return 0;

    if (pattern !== undefined && pattern !== "") {
        const path = candidateUri.fsPath;
        const matched =
            typeof pattern === "string"
                ? pattern === path || matchGlob(pattern, path)
                : matchRelativeGlob(pattern, path);
        if (!matched) return 0;
        ret = 10;
    }

    return ret;
}

export function isExclusive(selector: LanguageSelector): boolean {
    if (isSelectorArray(selector)) return selector.every(isExclusive);
    // У строки поля `exclusive` нет: чтение даёт undefined.
    return (selector as LanguageFilter).exclusive === true;
}
