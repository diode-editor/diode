import type * as vscode from "vscode";

import { matchDocumentSelector } from "./documentSelector.ts";
import type { ExtHostTextDocument } from "./extHostDocuments.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { DisposableImpl, EventEmitter, Position, Range, Uri } from "./vscodeTypes.ts";
import type { WireCompletionItem, WireDefinitionLocation, WireFoldingRange, WireMarker } from "./wireTypes.ts";

/** `vscode.Diagnostic` (утиный тип) → {@link WireMarker}; кривые поля — к дефолтам. */
function toWireMarker(diag: unknown): WireMarker {
    const d = diag as {
        range?: { start: { line: number; character: number }; end: { line: number; character: number } };
        message?: unknown;
        severity?: unknown;
        code?: unknown;
        source?: unknown;
    };
    const r = d.range ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    const code = typeof d.code === "string" || typeof d.code === "number" ? String(d.code) : undefined;
    return {
        severity: typeof d.severity === "number" ? d.severity : 0,
        startLine: r.start.line,
        startCharacter: r.start.character,
        endLine: r.end.line,
        endCharacter: r.end.character,
        message: typeof d.message === "string" ? d.message : String(d.message ?? ""),
        ...(code !== undefined ? { code } : {}),
        ...(typeof d.source === "string" ? { source: d.source } : {}),
    };
}

/** Зарегистрированный провайдер автодополнения. */
export interface ICompletionRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.CompletionItemProvider;
    readonly triggerCharacters: readonly string[];
}

/** Зарегистрированный провайдер областей сворачивания. */
export interface IFoldingRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.FoldingRangeProvider;
}

/** Зарегистрированный definition-провайдер. */
export interface IDefinitionRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.DefinitionProvider;
}

/** Wire-параметры запроса completion (host → subprocess). */
interface IWireCompletionParams {
    /** Ресурс как `uri.toString()`. */
    readonly uri: string;
    readonly languageId?: string;
    readonly text?: string;
    readonly line?: number;
    readonly character?: number;
}

/** Wire-параметры запроса folding (host → subprocess). */
interface IWireFoldingParams {
    /** Ресурс как `uri.toString()`. */
    readonly uri: string;
    readonly languageId?: string;
    readonly text?: string;
}

/** Wire-параметры запроса definition (host → subprocess). */
interface IWireDefinitionParams {
    /** Ресурс как `uri.toString()`. */
    readonly uri: string;
    readonly languageId?: string;
    readonly text?: string;
    readonly line?: number;
    readonly character?: number;
}

/** Сериализует `vscode.Range` (утиный тип) в wire-диапазон; `null`, если форма чужая. */
function serializeDefinitionRange(raw: unknown): WireDefinitionLocation["range"] | null {
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as { start?: { line?: unknown; character?: unknown }; end?: { line?: unknown; character?: unknown } };
    const { start, end } = r;
    if (
        start == null ||
        end == null ||
        typeof start.line !== "number" ||
        typeof start.character !== "number" ||
        typeof end.line !== "number" ||
        typeof end.character !== "number"
    ) {
        return null;
    }
    return {
        startLine: start.line,
        startCharacter: start.character,
        endLine: end.line,
        endCharacter: end.character,
    };
}

/**
 * Сериализует один элемент результата definition-провайдера: `Location`
 * (`{ uri, range }`) или `LocationLink` (`{ targetUri, targetRange,
 * targetSelectionRange? }` — прицельный диапазон `targetSelectionRange ??
 * targetRange`). `null` — форма не распознана (drop+skip).
 */
function serializeDefinitionLocation(item: unknown): WireDefinitionLocation | null {
    if (typeof item !== "object" || item === null) return null;
    const link = item as { targetUri?: unknown; targetRange?: unknown; targetSelectionRange?: unknown };
    if (link.targetUri != null) {
        const range = serializeDefinitionRange(link.targetSelectionRange ?? link.targetRange);
        return range === null ? null : { uri: String(link.targetUri), range };
    }
    const loc = item as { uri?: unknown; range?: unknown };
    if (loc.uri == null) return null;
    const range = serializeDefinitionRange(loc.range);
    return range === null ? null : { uri: String(loc.uri), range };
}

/** Токен отмены-заглушка (запросы completion короткоживущие, отмена не нужна). */
function neverCancelledToken(): vscode.CancellationToken {
    return {
        isCancellationRequested: false,
        onCancellationRequested: new EventEmitter<unknown>().event,
    } as unknown as vscode.CancellationToken;
}

/** Читает `label` элемента (строка или `CompletionItemLabel { label }`). */
function readLabel(item: vscode.CompletionItem): string | undefined {
    const label = (item as { label?: unknown }).label;
    if (typeof label === "string") return label;
    if (typeof label === "object" && label !== null && typeof (label as { label?: unknown }).label === "string") {
        return (label as { label: string }).label;
    }
    return undefined;
}

/** Читает `insertText` (строка или `SnippetString { value }`); fallback — label. */
function readInsertText(item: vscode.CompletionItem, label: string): string {
    const insert = (item as { insertText?: unknown }).insertText;
    if (typeof insert === "string") return insert;
    if (typeof insert === "object" && insert !== null && typeof (insert as { value?: unknown }).value === "string") {
        return (insert as { value: string }).value;
    }
    return label;
}

/** Читает `documentation` (строка или `MarkdownString { value }`). */
function readDocumentation(item: vscode.CompletionItem): string | undefined {
    const doc = (item as { documentation?: unknown }).documentation;
    if (typeof doc === "string") return doc;
    if (typeof doc === "object" && doc !== null && typeof (doc as { value?: unknown }).value === "string") {
        return (doc as { value: string }).value;
    }
    return undefined;
}

/** Читает диапазон замены (`Range` или `{ replacing, inserting }`). */
function readRange(item: vscode.CompletionItem): WireCompletionItem["range"] {
    const raw = (item as { range?: unknown }).range;
    if (raw === undefined || raw === null) return undefined;
    const range =
        raw instanceof Range
            ? raw
            : typeof raw === "object" && (raw as { replacing?: unknown }).replacing instanceof Range
              ? (raw as { replacing: Range }).replacing
              : undefined;
    if (range === undefined) return undefined;
    return {
        startLine: range.start.line,
        startCharacter: range.start.character,
        endLine: range.end.line,
        endCharacter: range.end.character,
    };
}

/** Сериализует `vscode.CompletionItem` в wire-форму (subprocess → host). */
function serializeCompletionItem(item: vscode.CompletionItem): WireCompletionItem | null {
    const label = readLabel(item);
    if (label === undefined || label === "") return null;
    const command = (item as { command?: { command?: unknown; arguments?: unknown } }).command;
    const kind = (item as { kind?: unknown }).kind;
    const detail = (item as { detail?: unknown }).detail;
    const sortText = (item as { sortText?: unknown }).sortText;
    const filterText = (item as { filterText?: unknown }).filterText;
    const documentation = readDocumentation(item);
    const range = readRange(item);
    return {
        label,
        insertText: readInsertText(item, label),
        ...(typeof kind === "number" ? { kind } : {}),
        ...(typeof detail === "string" ? { detail } : {}),
        ...(documentation !== undefined ? { documentation } : {}),
        ...(command !== undefined && typeof command.command === "string" && command.command !== ""
            ? {
                  command: {
                      command: command.command,
                      ...(Array.isArray(command.arguments) ? { arguments: command.arguments } : {}),
                  },
              }
            : {}),
        ...(range !== undefined ? { range } : {}),
        ...(typeof sortText === "string" ? { sortText } : {}),
        ...(typeof filterText === "string" ? { filterText } : {}),
    };
}

/** Нормализует результат провайдера в массив `CompletionItem`. */
function normalizeResult(result: unknown): readonly vscode.CompletionItem[] {
    if (result === undefined || result === null) return [];
    if (Array.isArray(result)) return result as vscode.CompletionItem[];
    const items = (result as { items?: unknown }).items;
    return Array.isArray(items) ? (items as vscode.CompletionItem[]) : [];
}

/** Сериализует `vscode.FoldingRange` в wire-форму; `null`, если форма битая. */
function serializeFoldingRange(range: vscode.FoldingRange): WireFoldingRange | null {
    const start = (range as { start?: unknown }).start;
    const end = (range as { end?: unknown }).end;
    if (typeof start !== "number" || !Number.isFinite(start)) return null;
    if (typeof end !== "number" || !Number.isFinite(end)) return null;
    const kind = (range as { kind?: unknown }).kind;
    return {
        start,
        end,
        ...(typeof kind === "number" ? { kind } : {}),
    };
}

/**
 * `vscode.languages` на стороне subprocess.
 *
 * Хранит регистрации провайдеров автодополнения и обслуживает host-запрос
 * `languages.provideCompletionItems`: обновляет полный снапшот документа в
 * реестре, матчит `DocumentSelector`, вызывает провайдеры и сериализует
 * результат. Наличие провайдеров сигналится хосту через
 * `languages.updateSubscriptions` (0↔1) — без провайдеров хост не гоняет RPC.
 */
export function createLanguagesNamespace(ctx: IVscodeHostContext): {
    languages: typeof vscode.languages;
    registrations: readonly ICompletionRegistration[];
    foldingRegistrations: readonly IFoldingRegistration[];
    definitionRegistrations: readonly IDefinitionRegistration[];
} {
    const { rpc, registry } = ctx;
    const registrations: ICompletionRegistration[] = [];
    const foldingRegistrations: IFoldingRegistration[] = [];
    const definitionRegistrations: IDefinitionRegistration[] = [];

    function pushSubscriptions(): void {
        rpc.notify("languages.updateSubscriptions", {
            hasCompletionProviders: registrations.length > 0,
            hasFoldingProviders: foldingRegistrations.length > 0,
            hasDefinitionProviders: definitionRegistrations.length > 0,
        });
    }

    rpc.handleRequest("languages.provideDefinition", async (params): Promise<WireDefinitionLocation[]> => {
        const p = params as IWireDefinitionParams;
        const doc: ExtHostTextDocument = registry.upsertFull({
            uri: p.uri,
            ...(typeof p.languageId === "string" ? { languageId: p.languageId } : {}),
            text: p.text ?? "",
        });
        const position = new Position(p.line ?? 0, p.character ?? 0);
        const token = neverCancelledToken();

        const locations: WireDefinitionLocation[] = [];
        for (const reg of definitionRegistrations) {
            if (!matchDocumentSelector(reg.selector, doc)) continue;
            let result: unknown;
            try {
                result = await Promise.resolve(
                    reg.provider.provideDefinition(
                        doc as unknown as vscode.TextDocument,
                        position as unknown as vscode.Position,
                        token,
                    ),
                );
            } catch {
                continue; // сбойный провайдер не роняет остальные
            }
            if (result == null) continue;
            for (const item of Array.isArray(result) ? result : [result]) {
                const wire = serializeDefinitionLocation(item);
                if (wire !== null) locations.push(wire);
            }
        }
        return locations;
    });

    rpc.handleRequest("languages.provideCompletionItems", async (params): Promise<WireCompletionItem[]> => {
        const p = params as IWireCompletionParams;
        const doc: ExtHostTextDocument = registry.upsertFull({
            uri: p.uri,
            ...(typeof p.languageId === "string" ? { languageId: p.languageId } : {}),
            text: p.text ?? "",
        });
        const position = new Position(p.line ?? 0, p.character ?? 0);
        const token = neverCancelledToken();
        const context = { triggerKind: 1, triggerCharacter: undefined } as unknown as vscode.CompletionContext;

        const items: WireCompletionItem[] = [];
        for (const reg of registrations) {
            if (!matchDocumentSelector(reg.selector, doc)) continue;
            let result: unknown;
            try {
                result = await Promise.resolve(
                    reg.provider.provideCompletionItems(
                        doc as unknown as vscode.TextDocument,
                        position as unknown as vscode.Position,
                        token,
                        context,
                    ),
                );
            } catch {
                continue; // сбойный провайдер не роняет остальные
            }
            for (const item of normalizeResult(result)) {
                const wire = serializeCompletionItem(item);
                if (wire !== null) items.push(wire);
            }
        }
        return items;
    });

    rpc.handleRequest("languages.provideFoldingRanges", async (params): Promise<WireFoldingRange[]> => {
        const p = params as IWireFoldingParams;
        const doc: ExtHostTextDocument = registry.upsertFull({
            uri: p.uri,
            ...(typeof p.languageId === "string" ? { languageId: p.languageId } : {}),
            text: p.text ?? "",
        });
        const token = neverCancelledToken();
        const context = {} as vscode.FoldingContext;

        const ranges: WireFoldingRange[] = [];
        for (const reg of foldingRegistrations) {
            if (!matchDocumentSelector(reg.selector, doc)) continue;
            let result: unknown;
            try {
                result = await Promise.resolve(
                    reg.provider.provideFoldingRanges(doc as unknown as vscode.TextDocument, context, token),
                );
            } catch {
                continue; // сбойный провайдер не роняет остальные
            }
            if (!Array.isArray(result)) continue;
            for (const range of result as vscode.FoldingRange[]) {
                const wire = serializeFoldingRange(range);
                if (wire !== null) ranges.push(wire);
            }
        }
        return ranges;
    });

    // No-op регистрация провайдера — валидный Disposable; фича не работает,
    // но стоковый клиент (vscode-languageclient заводит провайдеры под
    // capabilities сервера) не падает. Шаги закрытия каждого — docs/TODO/LSP.md.
    const registerNoopProvider = (): vscode.Disposable =>
        new DisposableImpl(() => undefined) as unknown as vscode.Disposable;

    /**
     * Коллекция диагностик, форвардящая маркеры хосту нотификацией
     * `diagnostics.publish` — хост пишет их в `MarkerService`, откуда их
     * подхватывают squiggle-декорации редактора и панель Problems. Ресурс
     * нормализуется в `uri.toString()` (ключ MarkerService).
     */
    const createDiagnosticCollection = (name?: string): vscode.DiagnosticCollection => {
        const owner = "ext:" + (name ?? "diagnostics");
        // Оригинальные Diagnostic'и расширения (контракт get/forEach); wire-форма
        // считается на публикации.
        const store = new Map<string, readonly vscode.Diagnostic[]>();

        const resourceOf = (uri: unknown): string => {
            if (typeof uri === "string") return Uri.parse(uri).toString();
            return String((uri as { toString(): string }).toString());
        };
        const publish = (resource: string, diags: readonly vscode.Diagnostic[]): void => {
            rpc.notify("diagnostics.publish", { owner, resource, markers: diags.map(toWireMarker) });
        };
        const setOne = (uri: unknown, diags: readonly vscode.Diagnostic[] | undefined): void => {
            const resource = resourceOf(uri);
            store.set(resource, diags ?? []);
            publish(resource, diags ?? []);
        };

        const collection = {
            name: name ?? "diagnostics",
            set: (arg: unknown, diags?: readonly vscode.Diagnostic[]): void => {
                // Перегрузка VS Code: set(uri, diags) | set([[uri, diags], …]).
                if (Array.isArray(arg)) {
                    for (const entry of arg as [unknown, readonly vscode.Diagnostic[] | undefined][]) {
                        setOne(entry[0], entry[1] ?? []);
                    }
                    return;
                }
                setOne(arg, diags);
            },
            delete: (uri: unknown): void => {
                const resource = resourceOf(uri);
                store.delete(resource);
                publish(resource, []);
            },
            clear: (): void => {
                for (const resource of store.keys()) publish(resource, []);
                store.clear();
            },
            forEach: (
                callback: (uri: unknown, diagnostics: readonly vscode.Diagnostic[], c: unknown) => unknown,
                thisArg?: unknown,
            ): void => {
                for (const [resource, diags] of store) callback.call(thisArg, Uri.parse(resource), diags, collection);
            },
            get: (uri: unknown): readonly vscode.Diagnostic[] | undefined => store.get(resourceOf(uri)),
            has: (uri: unknown): boolean => store.has(resourceOf(uri)),
            dispose: (): void => {
                collection.clear();
            },
            *[Symbol.iterator](): IterableIterator<[unknown, readonly vscode.Diagnostic[]]> {
                for (const [resource, diags] of store) yield [Uri.parse(resource), diags];
            },
        };
        return collection as unknown as vscode.DiagnosticCollection;
    };

    const languagesNs = {
        createDiagnosticCollection,
        // Наивный score DocumentSelector'а (языковой матч клиент делает сам).
        match: (): number => 10,

        registerCompletionItemProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.CompletionItemProvider,
            ...triggerCharacters: string[]
        ): vscode.Disposable => {
            const registration: ICompletionRegistration = { selector, provider, triggerCharacters };
            registrations.push(registration);
            if (registrations.length === 1) pushSubscriptions();
            return new DisposableImpl(() => {
                const idx = registrations.indexOf(registration);
                if (idx >= 0) {
                    registrations.splice(idx, 1);
                    if (registrations.length === 0) pushSubscriptions();
                }
            }) as unknown as vscode.Disposable;
        },
        registerFoldingRangeProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.FoldingRangeProvider,
        ): vscode.Disposable => {
            const registration: IFoldingRegistration = { selector, provider };
            foldingRegistrations.push(registration);
            if (foldingRegistrations.length === 1) pushSubscriptions();
            return new DisposableImpl(() => {
                const idx = foldingRegistrations.indexOf(registration);
                if (idx >= 0) {
                    foldingRegistrations.splice(idx, 1);
                    if (foldingRegistrations.length === 0) pushSubscriptions();
                }
            }) as unknown as vscode.Disposable;
        },
        registerDefinitionProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.DefinitionProvider,
        ): vscode.Disposable => {
            const registration: IDefinitionRegistration = { selector, provider };
            definitionRegistrations.push(registration);
            if (definitionRegistrations.length === 1) pushSubscriptions();
            return new DisposableImpl(() => {
                const idx = definitionRegistrations.indexOf(registration);
                if (idx >= 0) {
                    definitionRegistrations.splice(idx, 1);
                    if (definitionRegistrations.length === 0) pushSubscriptions();
                }
            }) as unknown as vscode.Disposable;
        },

        // ── No-op провайдеры (поверхность, которую трогает vscode-languageclient
        // под capabilities сервера). Закрытие каждого — по образцу definition:
        // seam + RPC + UI-потребитель; см. таблицу стабов в docs/TODO/LSP.md. ──
        registerDeclarationProvider: registerNoopProvider,
        registerImplementationProvider: registerNoopProvider,
        registerTypeDefinitionProvider: registerNoopProvider,
        registerHoverProvider: registerNoopProvider,
        registerReferenceProvider: registerNoopProvider,
        registerDocumentHighlightProvider: registerNoopProvider,
        registerDocumentSymbolProvider: registerNoopProvider,
        registerWorkspaceSymbolProvider: registerNoopProvider,
        registerCodeActionsProvider: registerNoopProvider,
        registerCodeLensProvider: registerNoopProvider,
        registerDocumentLinkProvider: registerNoopProvider,
        registerColorProvider: registerNoopProvider,
        registerDocumentFormattingEditProvider: registerNoopProvider,
        registerDocumentRangeFormattingEditProvider: registerNoopProvider,
        registerOnTypeFormattingEditProvider: registerNoopProvider,
        registerRenameProvider: registerNoopProvider,
        registerSelectionRangeProvider: registerNoopProvider,
        registerSignatureHelpProvider: registerNoopProvider,
        registerDocumentSemanticTokensProvider: registerNoopProvider,
        registerDocumentRangeSemanticTokensProvider: registerNoopProvider,
        registerInlayHintsProvider: registerNoopProvider,
        registerInlineValuesProvider: registerNoopProvider,
        registerInlineCompletionItemProvider: registerNoopProvider,
        registerLinkedEditingRangeProvider: registerNoopProvider,
        registerCallHierarchyProvider: registerNoopProvider,
        registerTypeHierarchyProvider: registerNoopProvider,
    };

    return {
        languages: languagesNs as unknown as typeof vscode.languages,
        registrations,
        foldingRegistrations,
        definitionRegistrations,
    };
}
