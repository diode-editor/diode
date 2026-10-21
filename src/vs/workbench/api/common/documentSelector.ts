import type * as vscode from "vscode";

import { score } from "../../../editor/common/languageSelector.ts";

import type { IWireLanguageFilter } from "./wireTypes.ts";

/** Shared with the core `languageSelector.score`: the subprocess and the core registry never disagree on matching. */
export function scoreDocumentSelector(selector: vscode.DocumentSelector, doc: vscode.TextDocument): number {
    return score(toWireLanguageFilters(selector), doc.uri, doc.languageId);
}

/** Like upstream's `ExtHostLanguageFeatures._transformDocumentSelector`. */
export function toWireLanguageFilters(selector: vscode.DocumentSelector): IWireLanguageFilter[] {
    const items: readonly (string | vscode.DocumentFilter)[] = Array.isArray(selector)
        ? (selector as readonly (string | vscode.DocumentFilter)[])
        : [selector as string | vscode.DocumentFilter];
    return items.map(toWireLanguageFilter);
}

function toWireLanguageFilter(item: string | vscode.DocumentFilter): IWireLanguageFilter {
    if (typeof item === "string") return { language: item };
    const { language, scheme, pattern } = item;
    // Fields outside the active vscode.d.ts surface (proposed / notebook) are read structurally.
    const { notebookType, exclusive } = item as { notebookType?: unknown; exclusive?: unknown };
    return {
        // Stryker disable next-line ConditionalExpression: the DTO goes over RPC as JSON, which drops undefined fields — `{language: undefined}` on the host is indistinguishable from absence
        ...(language === undefined ? {} : { language }),
        // Stryker disable next-line ConditionalExpression: same — an undefined field doesn't survive RPC JSON serialization
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
