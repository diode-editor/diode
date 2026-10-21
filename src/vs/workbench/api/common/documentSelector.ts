import type * as vscode from "vscode";

import { score } from "../../../editor/common/languageSelector.ts";

import type { IWireLanguageFilter } from "./wireTypes.ts";

/** Общий с ядром `languageSelector.score`: субпроцесс и реестр ядра не расходятся в матчинге. */
export function scoreDocumentSelector(selector: vscode.DocumentSelector, doc: vscode.TextDocument): number {
    return score(toWireLanguageFilters(selector), doc.uri, doc.languageId);
}

/** Как `ExtHostLanguageFeatures._transformDocumentSelector` эталона. */
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
