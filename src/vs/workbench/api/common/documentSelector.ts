import type * as vscode from "vscode";

import { matchGlob } from "../../../base/common/glob.ts";

import type { ExtHostTextDocument } from "./extHostDocuments.ts";

/**
 * Матчинг `vscode.DocumentSelector` против документа (subprocess-side, WP8).
 *
 * Минимальная реализация `languages.match`: поддерживает строковый селектор
 * (сахар для `{ language }`), `DocumentFilter { language?, scheme?, pattern? }`
 * и массив (any-match). `pattern` — мини-glob по абсолютному пути
 * ({@link matchGlob}), которого достаточно для editorconfig-подобных селекторов.
 */
export function matchDocumentSelector(selector: vscode.DocumentSelector, doc: ExtHostTextDocument): boolean {
    if (Array.isArray(selector)) {
        return selector.some((s) => matchDocumentSelector(s as vscode.DocumentSelector, doc));
    }
    if (typeof selector === "string") {
        return matchLanguage(selector, doc);
    }
    return matchFilter(selector as vscode.DocumentFilter, doc);
}

function matchLanguage(language: string, doc: ExtHostTextDocument): boolean {
    return language === "*" || language === doc.languageId;
}

function matchFilter(filter: vscode.DocumentFilter, doc: ExtHostTextDocument): boolean {
    if (filter.language !== undefined && !matchLanguage(filter.language, doc)) return false;
    if (filter.scheme !== undefined && filter.scheme !== "*" && filter.scheme !== doc.uri.scheme) return false;
    if (typeof filter.pattern === "string" && !matchGlob(filter.pattern, doc.uri.fsPath)) return false;
    // Хотя бы одно ограничение должно присутствовать (пустой фильтр не матчит).
    return filter.language !== undefined || filter.scheme !== undefined || filter.pattern !== undefined;
}
