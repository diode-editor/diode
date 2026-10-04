import type * as vscode from "vscode";

import { score } from "../../../editor/common/languageSelector.ts";

import type { ExtHostTextDocument } from "./extHostDocuments.ts";
import type { IWireLanguageFilter } from "./wireTypes.ts";

/**
 * `languages.match` (upstream `ExtHostLanguages.match` → `score`): насколько
 * селектор расширения подходит документу — 10 точное совпадение, 5 по `*`,
 * 0 не подходит. Считает общий с ядром `editor/common/languageSelector.score`
 * по DTO селектора, так что субпроцесс и реестр ядра не расходятся в матчинге.
 */
export function scoreDocumentSelector(selector: vscode.DocumentSelector, doc: ExtHostTextDocument): number {
    return score(toWireLanguageFilters(selector), doc.uri, doc.languageId);
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
