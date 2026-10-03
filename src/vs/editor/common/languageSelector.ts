import { type IRelativePattern, matchGlob, matchRelativeGlob } from "../../base/common/glob.ts";
import type { Uri } from "../../base/common/uri.ts";

/**
 * Фильтр документа для языкового провайдера (upstream
 * `vs/editor/common/languageSelector.ts`, ядро-сторона `vscode.DocumentFilter`).
 *
 * Из upstream не перенесены `hasAccessToAllModels` и `isBuiltin` (у нас нет
 * провайдеров в UI-потоке и встроенных расширений с понижением приоритета).
 * `notebookType` принимается, но ноутбуков у нас нет — фильтр с ним не матчит
 * ничего.
 */
export interface LanguageFilter {
    readonly language?: string;
    readonly scheme?: string;
    readonly pattern?: string | IRelativePattern;
    readonly notebookType?: string;
    /** Эксклюзивный провайдер при совпадении глушит всех остальных (см. `LanguageFeatureRegistry`). */
    readonly exclusive?: boolean;
}

export type LanguageSelector = string | LanguageFilter | readonly (string | LanguageFilter)[];

/**
 * Насколько селектор подходит документу: 10 — точное совпадение, 5 — по `*`,
 * 0 — не подходит. У массива — максимум по элементам. Порт upstream `score`
 * без notebook-ветки.
 *
 * Параметра upstream `candidateIsSynchronized` нет: «слишком большой для
 * синхронизации» документ у нас не выделяется — хосту уходит любой.
 */
export function score(selector: LanguageSelector | undefined, candidateUri: Uri, candidateLanguage: string): number {
    if (isSelectorArray(selector)) {
        // Массив → максимум по элементам.
        let ret = 0;
        for (const filter of selector) {
            const value = score(filter, candidateUri, candidateLanguage);
            // Stryker disable next-line ConditionalExpression,BlockStatement: ранний выход — оптимизация; без него цикл дойдёт до того же максимума
            if (value === 10) return value;
            if (value > ret) ret = value;
        }
        return ret;
    }
    if (typeof selector === "string") {
        // Сахар: 'fooLang' → { language: 'fooLang' }, '*' → { language: '*' }.
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

    // Ноутбуков нет: документ никогда не ячейка, фильтр по типу ноутбука не матчит.
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

/** Эксклюзивен ли селектор: строка — нет, массив — когда эксклюзивны все элементы. */
export function isExclusive(selector: LanguageSelector): boolean {
    if (typeof selector === "string") return false;
    if (isSelectorArray(selector)) return selector.every(isExclusive);
    return selector.exclusive === true;
}
