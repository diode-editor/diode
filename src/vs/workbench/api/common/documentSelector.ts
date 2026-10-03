import type * as vscode from "vscode";

import { matchGlob } from "../../../base/common/glob.ts";

import type { ExtHostTextDocument } from "./extHostDocuments.ts";
import type { IWireLanguageFilter } from "./wireTypes.ts";

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

/**
 * Селектор расширения → DTO для `languages.register` (upstream
 * `ExtHostLanguageFeatures._transformDocumentSelector`): строка разворачивается
 * в `{ language }`, `RelativePattern` — в `{ base: fsPath, pattern }`, одиночный
 * фильтр — в массив из одного. Скоринг по DTO делает ядро.
 */
export function toWireLanguageFilters(selector: vscode.DocumentSelector): IWireLanguageFilter[] {
    const items: readonly (string | vscode.DocumentFilter)[] = Array.isArray(selector)
        ? (selector as readonly (string | vscode.DocumentFilter)[])
        : [selector as string | vscode.DocumentFilter];
    return items.map(toWireLanguageFilter);
}

function toWireLanguageFilter(item: string | vscode.DocumentFilter): IWireLanguageFilter {
    if (typeof item === "string") return { language: item };
    const { language, scheme, pattern } = item;
    // Поля вне активной поверхности vscode.d.ts (proposed / notebook) — читаем структурно.
    const { notebookType, exclusive } = item as { notebookType?: unknown; exclusive?: unknown };
    return {
        // Stryker disable next-line ConditionalExpression: DTO уходит по RPC JSON'ом, а он выбрасывает undefined-поля — `{language: undefined}` на хосте неотличим от отсутствия
        ...(language === undefined ? {} : { language }),
        // Stryker disable next-line ConditionalExpression: то же — undefined-поле не переживает JSON-сериализацию RPC
        ...(scheme === undefined ? {} : { scheme }),
        ...(pattern === undefined ? {} : { pattern: toWirePattern(pattern) }),
        ...(typeof notebookType === "string" ? { notebookType } : {}),
        ...(exclusive === true ? { exclusive: true } : {}),
    };
}

function toWirePattern(pattern: vscode.GlobPattern): IWireLanguageFilter["pattern"] {
    if (typeof pattern === "string") return pattern;
    return { base: pattern.baseUri.fsPath, pattern: pattern.pattern };
}
