import { type IRelativePattern, matchGlob, matchRelativeGlob } from "../../base/common/glob.ts";
import type { Uri } from "../../base/common/uri.ts";

/**
 * Upstream `languageSelector.ts` without `hasAccessToAllModels` and `isBuiltin`.
 * `notebookType` is accepted, but there are no notebooks: a filter with it matches nothing.
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
 * 10 for an exact match, 5 for `*`, 0 for no match. There is no upstream
 * `candidateIsSynchronized` parameter: every document is sent to the host.
 */
export function score(selector: LanguageSelector | undefined, candidateUri: Uri, candidateLanguage: string): number {
    if (isSelectorArray(selector)) {
        let ret = 0;
        for (const filter of selector) {
            const value = score(filter, candidateUri, candidateLanguage);
            // Stryker disable next-line ConditionalExpression,BlockStatement: the early exit is an optimization; without it the loop reaches the same maximum
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

    // Upstream treats empty strings as "no constraint" (a truthy check).
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
    // A string has no `exclusive` field: reading it gives undefined.
    return (selector as LanguageFilter).exclusive === true;
}
