import type * as vscode from "vscode";

import { describeRejection } from "../../../base/common/describeRejection.ts";
import { CancellationError, isCancellationError } from "../../../base/common/errorSerialization.ts";
import type { IRange } from "../../../editor/common/core/iRange.ts";
import type {
    ICoreCompletionItem,
    ICoreCompletionResult,
    ICoreResolvedCompletion,
} from "../../../editor/common/languages/iCompletionSource.ts";
import type { ICoreDefinitionLocation } from "../../../editor/common/languages/iDefinitionSource.ts";
import type { ICoreHover } from "../../../editor/common/languages/iHoverSource.ts";
import type { ICoreInlineCompletionItem } from "../../../editor/common/languages/iInlineCompletionSource.ts";
import type { ICoreReference } from "../../../editor/common/languages/iReferenceSource.ts";
import type { ICoreSignatureHelp } from "../../../editor/common/languages/iSignatureHelpSource.ts";

import { implementsApi } from "./apiSurface.ts";
import { scoreDocumentSelector, toWireLanguageFilters } from "./documentSelector.ts";
import type { ExtHostTextDocument } from "./extHostDocuments.ts";
import { createSetLanguageConfiguration } from "./extHostLanguageConfiguration.ts";
import { DocumentRangeSemanticTokensAdapter, DocumentSemanticTokensAdapter } from "./extHostSemanticTokens.ts";
import {
    rangeFrom,
    readAdditionalTextEdits,
    readDocumentation,
    serializeCompletionItem,
    serializeDefinitionLocation,
    serializeFoldingRange,
    serializeHoverContents,
    serializeInlineCompletionItem,
    serializeRenamePrepare,
    serializeSelectionRanges,
    serializeSignatureHelp,
    serializeTextEdit,
    toVscodeDiagnostic,
    toVscodeRange,
    toVscodeSignatureHelp,
    toWireMarker,
} from "./extHostTypeConverters.ts";
import { callWithVscodeToken, toVscodeCancellationToken } from "./vscodeCancellation.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import {
    CodeAction,
    CodeActionKind,
    CodeActionTriggerKind,
    CompletionTriggerKind,
    DisposableImpl,
    EventEmitter,
    InlineCompletionTriggerKind,
    Position,
    Range,
    SignatureHelpTriggerKind,
    Uri,
    WorkspaceEdit,
} from "./vscodeTypes.ts";
import type {
    IWireCodeActionParams,
    IWireCompletionParams,
    IWireDefinitionParams,
    IWireDocumentSemanticTokensParams,
    IWireEditorEdit,
    IWireFoldingParams,
    IWireForeignMarkers,
    IWireFormattingParams,
    IWireHoverParams,
    IWireInlineCompletionParams,
    IWireLanguageProviderMetadata,
    IWirePrepareRenameParams,
    IWireRangeSemanticTokensParams,
    IWireReferenceParams,
    IWireReleaseSemanticTokens,
    IWireRenameParams,
    IWireSelectionRangeParams,
    IWireSignatureHelpParams,
    Received,
    WireCodeAction,
    WireFoldingRange,
    WireLanguageFeatureKind,
    WireMarker,
    WireRenamePrepare,
    WireRenameResult,
    WireSemanticTokensResult,
} from "./wireTypes.ts";
import { isFiniteNumber, parseRange } from "./wireTypes.ts";

export interface ICompletionRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.CompletionItemProvider;
    readonly triggerCharacters: readonly string[];
}

export interface IInlineCompletionRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.InlineCompletionItemProvider;
}

export interface IFoldingRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.FoldingRangeProvider;
}

export interface IDocumentSemanticTokensRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly adapter: DocumentSemanticTokensAdapter;
}

export interface IRangeSemanticTokensRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly adapter: DocumentRangeSemanticTokensAdapter;
}

export interface IDefinitionRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.DefinitionProvider;
}

export interface IRenameRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.RenameProvider;
}

export interface ISelectionRangeRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.SelectionRangeProvider;
}

export interface IHoverRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.HoverProvider;
}

export interface IReferenceRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.ReferenceProvider;
}

export interface ISignatureHelpRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.SignatureHelpProvider;
    readonly triggerCharacters: readonly string[];
    readonly retriggerCharacters: readonly string[];
}

export interface ICodeActionRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.CodeActionProvider;
    readonly providedKinds: readonly string[];
}

export interface IFormattingRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.DocumentFormattingEditProvider;
}

export interface IRangeFormattingRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.DocumentRangeFormattingEditProvider;
}

/** `undefined` — регистрация вне оверлея расширения. */
interface IRegistrationOwner {
    readonly owner: string | undefined;
}

type Owned<T> = T & IRegistrationOwner;

interface ICachedCompletion extends IRegistrationOwner {
    readonly item: vscode.CompletionItem;
    readonly provider: vscode.CompletionItemProvider;
}

const COMPLETION_CACHE_DEPTH = 2;

function parseWireMarkersChanged(raw: unknown): IWireForeignMarkers[] {
    const entries = (raw as { entries?: unknown } | null)?.entries;
    if (!Array.isArray(entries)) return [];
    const result: IWireForeignMarkers[] = [];
    for (const item of entries as unknown[]) {
        const entry = item as { resource?: unknown; markers?: unknown } | null;
        if (typeof entry?.resource !== "string" || !Array.isArray(entry.markers)) continue;
        const markers: WireMarker[] = [];
        for (const rawMarker of entry.markers as unknown[]) {
            const m = (rawMarker ?? {}) as Record<string, unknown>;
            const range = parseRange(m.range);
            if (range === null || !isFiniteNumber(m.severity) || typeof m.message !== "string") continue;
            markers.push({
                severity: m.severity,
                range,
                message: m.message,
                ...(typeof m.code === "string" ? { code: m.code } : {}),
                ...(typeof m.source === "string" ? { source: m.source } : {}),
            });
        }
        result.push({ resource: entry.resource, markers });
    }
    return result;
}

/** `delay` DebounceEmitter'а ExtHostDiagnostics эталона. */
const DIAGNOSTICS_CHANGE_DELAY_MS = 50;

interface ICachedCodeAction {
    readonly item: vscode.CodeAction | vscode.Command;
    readonly registration: Owned<ICodeActionRegistration>;
}

/** Границы включительно (как `vscode.Range.intersection`). */
function rangesIntersect(a: Range, b: Range): boolean {
    const startsBeforeOrAt = (x: Position, y: Position): boolean =>
        x.line < y.line || (x.line === y.line && x.character <= y.character);
    return startsBeforeOrAt(a.start, b.end) && startsBeforeOrAt(b.start, a.end);
}

/** Провайдер вправе отклонить промис чем угодно, не только `Error`. */
function renameRejectReason(error: unknown): string {
    if (typeof error === "string" && error !== "") return error;
    const message = (error as { message?: unknown } | null | undefined)?.message;
    if (typeof message === "string" && message !== "") return message;
    return "Rename failed";
}

/**
 * Объект-метаданные (стоковый клиент выбирает его, когда сервер прислал
 * `retriggerCharacters`) или rest-строки триггер-символов.
 */
function readSignatureHelpMetadata(rest: readonly unknown[]): {
    triggerCharacters: readonly string[];
    retriggerCharacters: readonly string[];
} {
    const first = rest.at(0);
    // Stryker disable next-line ConditionalExpression: `null` третьим аргументом клиент не передаёт, а если бы передал — обе ветки дали бы пустые списки символов
    if (typeof first === "object" && first !== null) {
        const metadata = first as Partial<vscode.SignatureHelpProviderMetadata>;
        return {
            triggerCharacters: readStringList(metadata.triggerCharacters),
            retriggerCharacters: readStringList(metadata.retriggerCharacters),
        };
    }
    return { triggerCharacters: readStringList(rest), retriggerCharacters: [] };
}

function readStringList(raw: unknown): readonly string[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is string => typeof item === "string");
}

/**
 * `isIncomplete` — не косметика: по нему ядро перезапрашивает провайдеров при
 * доборе символа вместо локальной фильтрации (у tsserver список почти всегда неполный).
 */
function normalizeResult(result: unknown): { items: readonly vscode.CompletionItem[]; isIncomplete: boolean } {
    if (result === undefined || result === null) return { items: [], isIncomplete: false };
    if (Array.isArray(result)) return { items: result as vscode.CompletionItem[], isIncomplete: false };
    const items = (result as { items?: unknown }).items;
    const isIncomplete = (result as { isIncomplete?: unknown }).isIncomplete === true;
    return { items: Array.isArray(items) ? (items as vscode.CompletionItem[]) : [], isIncomplete };
}

/**
 * Сбой провайдера не роняет команду, но и не молчит: молчаливый сбой стокового
 * prettier выглядел как «менять нечего», и следа не было ни в одном логе (#381).
 */
function reportProviderFailure(method: string, err: unknown, owner: string | undefined): void {
    if (isCancellationError(err)) return;
    const tag = owner === undefined ? "" : `[${owner}] `;
    console.error(`[ext-host] ${tag}${method} failed: ${describeRejection(err)}`);
}

export interface ICodeActionDeps {
    readonly applyEdit: (edit: vscode.WorkspaceEdit, metadata?: vscode.WorkspaceEditMetadata) => Thenable<boolean>;
    readonly executeCommand: (command: string, ...args: unknown[]) => Thenable<unknown>;
}

const NULL_CODE_ACTION_DEPS: ICodeActionDeps = {
    // Stryker disable next-line ArrowFunction: `undefined` и `Promise<false>` для applyCodeAction неотличимы — оба читаются как «не применилось»
    applyEdit: () => Promise.resolve(false),
    executeCommand: () => Promise.reject(new Error("commands bridge is not wired")),
};

export function createLanguagesNamespace(
    ctx: IVscodeHostContext,
    codeActionDeps: ICodeActionDeps = NULL_CODE_ACTION_DEPS,
): {
    languages: typeof vscode.languages;
} {
    const { rpc, documentSync } = ctx;
    // По handle из запроса ядра (как ExtHostLanguageFeatures._adapter эталона).
    const hoverProviders = new Map<number, Owned<IHoverRegistration>>();
    const definitionProviders = new Map<number, Owned<IDefinitionRegistration>>();
    const referenceProviders = new Map<number, Owned<IReferenceRegistration>>();
    const signatureHelpProviders = new Map<number, Owned<ISignatureHelpRegistration>>();
    const completionProviders = new Map<number, Owned<ICompletionRegistration>>();
    const formattingProviders = new Map<number, Owned<IFormattingRegistration>>();
    const rangeFormattingProviders = new Map<number, Owned<IRangeFormattingRegistration>>();
    const codeActionProviders = new Map<number, Owned<ICodeActionRegistration>>();
    const foldingProviders = new Map<number, Owned<IFoldingRegistration>>();
    const inlineCompletionProviders = new Map<number, Owned<IInlineCompletionRegistration>>();
    const renameProviders = new Map<number, Owned<IRenameRegistration>>();
    const selectionRangeProviders = new Map<number, Owned<ISelectionRangeRegistration>>();
    const semanticTokensProviders = new Map<number, Owned<IDocumentSemanticTokensRegistration>>();
    const rangeSemanticTokensProviders = new Map<number, Owned<IRangeSemanticTokensRegistration>>();
    let nextProviderHandle = 0;

    /** Скоринг по селектору делает ядро: субпроцесс зовут уже с выбранным handle. */
    function registerByHandle<T>(
        providers: Map<number, Owned<T>>,
        kind: WireLanguageFeatureKind,
        selector: vscode.DocumentSelector,
        registration: T,
        metadata: IWireLanguageProviderMetadata = {},
        onUnregister?: (handle: number) => void,
        subscribe?: (handle: number) => vscode.Disposable | undefined,
    ): vscode.Disposable {
        const handle = nextProviderHandle++;
        // Владелец запоминается сейчас: оверлей выставляет его только на время
        // синхронного `register*`, а сбой провайдера случится много позже.
        providers.set(handle, { ...registration, owner: ctx.owner.current });
        rpc.notify("languages.register", { handle, kind, selector: toWireLanguageFilters(selector), ...metadata });
        const subscription = subscribe?.(handle);
        return new DisposableImpl(() => {
            if (!providers.delete(handle)) return;
            rpc.notify("languages.unregister", { handle });
            subscription?.dispose();
            onUnregister?.(handle);
        });
    }

    // Глубина COMPLETION_CACHE_DEPTH: гонка «ответ пришёл, попап уже перезапросил»
    // стоит одного лишнего ведра.
    const completionCache = new Map<number, readonly ICachedCompletion[]>();
    let nextCacheId = 1;

    function rememberCompletions(cacheId: number, items: readonly ICachedCompletion[]): void {
        completionCache.set(cacheId, items);
        const excess = completionCache.size - COMPLETION_CACHE_DEPTH;
        for (const key of [...completionCache.keys()].slice(0, excess)) completionCache.delete(key);
    }

    function findCachedCompletion(id: string): ICachedCompletion | null {
        const [rawCacheId, rawIndex] = id.split(".");
        const bucket = completionCache.get(Number(rawCacheId));
        return bucket?.[Number(rawIndex)] ?? null;
    }

    // Применять нужно ТОТ ЖЕ объект действия, что вернул провайдер (у клиента —
    // ProtocolCodeAction с приватным `data`). Глубина — на провайдера, как у эталона
    // (`CodeActionAdapter._cache`): общая глубина 2 при трёх провайдерах вытесняла
    // ведро самого быстрого до выбора пункта — «Code action failed».
    const codeActionCache = new Map<
        number,
        { readonly handle: number; readonly items: readonly ICachedCodeAction[] }
    >();

    function rememberCodeActions(cacheId: number, handle: number, items: readonly ICachedCodeAction[]): void {
        codeActionCache.set(cacheId, { handle, items });
        const own = [...codeActionCache].filter(([, bucket]) => bucket.handle === handle);
        const excess = own.length - COMPLETION_CACHE_DEPTH;
        for (const [key] of own.slice(0, excess)) codeActionCache.delete(key);
    }

    function forgetCodeActions(handle: number): void {
        for (const [key, bucket] of codeActionCache) {
            if (bucket.handle === handle) codeActionCache.delete(key);
        }
    }

    function findCachedCodeAction(id: string): ICachedCodeAction | null {
        const [rawCacheId, rawIndex] = id.split(".");
        const bucket = codeActionCache.get(Number(rawCacheId))?.items;
        return bucket?.[Number(rawIndex)] ?? null;
    }

    // Контекст code actions — ТЕ ЖЕ объекты Diagnostic, что публиковал клиент.
    const diagnosticStores = new Set<Map<string, readonly vscode.Diagnostic[]>>();
    // Ключи MarkerService не переиспользуются: счётчик на базу ключа.
    const diagnosticOwnerCounts = new Map<string, number>();
    // Зеркало чужих маркеров — `_mirrorCollection` эталона.
    const mirrorStore = new Map<string, readonly vscode.Diagnostic[]>();

    // Как DebounceEmitter эталона: первое изменение открывает окно, накопленное уходит
    // одним событием с уникальными ресурсами в порядке первого появления.
    const diagnosticsChanged = new EventEmitter<vscode.DiagnosticChangeEvent>();
    let changedResources: string[] = [];
    let changedTimer: ReturnType<typeof setTimeout> | undefined;
    function diagnosticsChangedFor(resources: readonly string[]): void {
        changedResources.push(...resources);
        if (changedTimer !== undefined) return;
        changedTimer = setTimeout(() => {
            changedTimer = undefined;
            const uris = [...new Set(changedResources)].map((resource) => Uri.parse(resource));
            changedResources = [];
            diagnosticsChanged.fire({ uris: Object.freeze(uris) });
        }, DIAGNOSTICS_CHANGE_DELAY_MS);
    }

    rpc.handleNotification("diagnostics.markersChanged", (params) => {
        const entries = parseWireMarkersChanged(params);
        // Как эталон, зеркало встаёт в набор на первом сообщении — после уже
        // заведённых коллекций.
        diagnosticStores.add(mirrorStore);
        for (const { resource, markers } of entries) mirrorStore.set(resource, markers.map(toVscodeDiagnostic));
        diagnosticsChangedFor(entries.map((entry) => entry.resource));
    });

    function getDiagnostics(resource: vscode.Uri): vscode.Diagnostic[];
    function getDiagnostics(): [vscode.Uri, vscode.Diagnostic[]][];
    // `null` от JS-расширения — как «без ресурса» (у эталона проверка на truthy).
    function getDiagnostics(resource?: vscode.Uri | null): vscode.Diagnostic[] | [vscode.Uri, vscode.Diagnostic[]][] {
        if (resource != null) {
            const key = resource.toString();
            return [...diagnosticStores].flatMap((store) => store.get(key) ?? []);
        }
        const byResource = new Map<string, vscode.Diagnostic[]>();
        for (const store of diagnosticStores) {
            for (const [key, diags] of store) byResource.set(key, [...(byResource.get(key) ?? []), ...diags]);
        }
        return [...byResource].map(([key, diags]): [vscode.Uri, vscode.Diagnostic[]] => [Uri.parse(key), diags]);
    }

    function diagnosticsIntersecting(resource: string, range: Range): vscode.Diagnostic[] {
        const found: vscode.Diagnostic[] = [];
        for (const store of diagnosticStores) {
            // Stryker disable next-line ArrayDeclaration: фолбэк-массив немедленно фильтруется по range — содержимое ненаблюдаемо
            for (const diag of store.get(resource) ?? []) {
                const diagRange = (diag as { range?: Range }).range;
                if (diagRange === undefined) continue;
                if (rangesIntersect(diagRange, range)) found.push(diag);
            }
        }
        return found;
    }

    rpc.handleRequest(
        "languages.provideDefinition",
        async (params, cancellation): Promise<ICoreDefinitionLocation[]> => {
            const p: Received<IWireDefinitionParams> = params;
            const reg = definitionProviders.get(p.handle ?? -1);
            if (reg === undefined) return [];
            const doc = documentSync.resolve(p.uri, p.version, p.languageId);
            if (doc === null) return [];
            const position = new Position(p.line ?? 0, p.character ?? 0);
            let result: unknown;
            try {
                result = await callWithVscodeToken(cancellation, (token) =>
                    reg.provider.provideDefinition(doc, position, token),
                );
            } catch (err) {
                reportProviderFailure("provideDefinition", err, reg.owner);
            }
            const locations: ICoreDefinitionLocation[] = [];
            for (const item of Array.isArray(result) ? result : [result]) {
                const wire = serializeDefinitionLocation(item);
                if (wire !== null) locations.push(wire);
            }
            return locations;
        },
    );

    rpc.handleRequest("languages.provideHover", async (params, cancellation): Promise<ICoreHover | null> => {
        const p: Received<IWireHoverParams> = params;
        const reg = hoverProviders.get(p.handle ?? -1);
        if (reg === undefined) return null;
        const doc = documentSync.resolve(p.uri, p.version, p.languageId);
        if (doc === null) return null;
        const position = new Position(p.line ?? 0, p.character ?? 0);
        let result: unknown;
        try {
            result = await callWithVscodeToken(cancellation, (token) =>
                reg.provider.provideHover(doc, position, token),
            );
        } catch (err) {
            reportProviderFailure("provideHover", err, reg.owner);
        }
        if (result == null) return null;
        const contents = serializeHoverContents((result as { contents?: unknown }).contents);
        if (contents.length === 0) return null;
        const range = rangeFrom((result as { range?: unknown }).range);
        return { contents, ...(range === null ? {} : { range }) };
    });

    rpc.handleRequest("languages.provideSelectionRanges", async (params, cancellation): Promise<IRange[][]> => {
        const p: Received<IWireSelectionRangeParams> = params;
        const reg = selectionRangeProviders.get(p.handle ?? -1);
        if (reg === undefined) return [];
        const doc = documentSync.resolve(p.uri, p.version, p.languageId);
        if (doc === null) return [];
        const wirePositions = p.positions ?? [];
        const positions = wirePositions.map((pos) => new Position(pos.line, pos.character));
        let result: unknown;
        try {
            result = await callWithVscodeToken(cancellation, (token) =>
                reg.provider.provideSelectionRanges(doc, positions, token),
            );
        } catch (err) {
            reportProviderFailure("provideSelectionRanges", err, reg.owner);
        }
        return serializeSelectionRanges(result, wirePositions);
    });

    rpc.handleRequest(
        "languages.provideSignatureHelp",
        async (params, cancellation): Promise<ICoreSignatureHelp | null> => {
            // Всё, кроме `uri`, необязательно: дефолты ниже — обработка недоехавшего по RPC поля.
            const p: Received<IWireSignatureHelpParams> = params;
            const reg = signatureHelpProviders.get(p.handle ?? -1);
            if (reg === undefined) return null;
            const doc = documentSync.resolve(p.uri, p.version, p.languageId);
            if (doc === null) return null;
            const position = new Position(p.line ?? 0, p.character ?? 0);
            const context: vscode.SignatureHelpContext = {
                triggerKind: p.triggerKind ?? SignatureHelpTriggerKind.Invoke,
                triggerCharacter: p.triggerCharacter,
                isRetrigger: p.isRetrigger === true,
                activeSignatureHelp:
                    p.activeSignatureHelp === undefined ? undefined : toVscodeSignatureHelp(p.activeSignatureHelp),
            };
            let result: unknown;
            try {
                result = await callWithVscodeToken(cancellation, (token) =>
                    reg.provider.provideSignatureHelp(doc, position, token, context),
                );
            } catch (err) {
                reportProviderFailure("provideSignatureHelp", err, reg.owner);
            }
            return serializeSignatureHelp(result);
        },
    );

    rpc.handleRequest("languages.provideReferences", async (params, cancellation): Promise<ICoreReference[]> => {
        const p: Received<IWireReferenceParams> = params;
        const reg = referenceProviders.get(p.handle ?? -1);
        if (reg === undefined) return [];
        const doc = documentSync.resolve(p.uri, p.version, p.languageId);
        if (doc === null) return [];
        const position = new Position(p.line ?? 0, p.character ?? 0);
        const context: vscode.ReferenceContext = { includeDeclaration: p.includeDeclaration === true };
        let result: unknown;
        try {
            result = await callWithVscodeToken(cancellation, (token) =>
                reg.provider.provideReferences(doc, position, context, token),
            );
        } catch (err) {
            reportProviderFailure("provideReferences", err, reg.owner);
        }
        if (!Array.isArray(result)) return [];
        const references: ICoreReference[] = [];
        for (const item of result) {
            const wire = serializeDefinitionLocation(item);
            if (wire !== null) references.push(wire);
        }
        return references;
    });

    function syncRenameTarget(
        p: Received<IWirePrepareRenameParams>,
    ): { doc: ExtHostTextDocument; position: Position } | null {
        const doc = documentSync.resolve(p.uri, p.version, p.languageId);
        if (doc === null) return null;
        return { doc, position: new Position(p.line ?? 0, p.character ?? 0) };
    }

    rpc.handleRequest("languages.prepareRename", async (params, cancellation): Promise<WireRenamePrepare | null> => {
        const p: Received<IWirePrepareRenameParams> = params;
        const reg = renameProviders.get(p.handle ?? -1);
        if (reg === undefined) return null;
        const prepare = reg.provider.prepareRename?.bind(reg.provider);
        // Без `prepareRename` — не отказ: эталон переименовывает слово под кареткой,
        // а что считать словом, решает ядро.
        if (prepare === undefined) return null;
        const target = syncRenameTarget(p);
        if (target === null) return null;
        const { doc, position } = target;
        let result: unknown;
        try {
            result = await callWithVscodeToken(cancellation, (token) => prepare(doc, position, token));
        } catch (error) {
            // «Здесь нельзя» эталон выражает отказом промиса — это ответ, а не сбой.
            return { rejectReason: renameRejectReason(error) };
        }
        if (result == null) return null;
        return serializeRenamePrepare(result, doc);
    });

    rpc.handleRequest("languages.provideRenameEdits", async (params, cancellation): Promise<WireRenameResult> => {
        const p: Received<IWireRenameParams> = params;
        const reg = renameProviders.get(p.handle ?? -1);
        if (reg === undefined) return { applied: false };
        const { newName } = p;
        if (typeof newName !== "string" || newName === "") {
            return { applied: false, error: "Rename requires a new name" };
        }
        const target = syncRenameTarget(p);
        if (target === null) return { applied: false, error: "The document changed during rename" };
        const { doc, position } = target;
        let edit: unknown;
        try {
            edit = await callWithVscodeToken(cancellation, (token) =>
                reg.provider.provideRenameEdits(doc, position, newName, token),
            );
        } catch (error) {
            // Отклонённый промис — штатный канал эталона «имя невалидно»: сообщение едет человеку.
            return { applied: false, error: renameRejectReason(error) };
        }
        if (!(edit instanceof WorkspaceEdit)) return { applied: false };
        // Rename — рефакторинг: эталон `respectAutoSaveConfig: true`.
        const ok = await codeActionDeps.applyEdit(edit, { isRefactoring: true });
        return ok ? { applied: true } : { applied: false, error: "Rename failed to apply edits" };
    });

    // Один RPC на оба вида (#196): с `range` — range-провайдер (в т. ч. формат документа
    // range-провайдером на полный диапазон), без — документный.
    rpc.handleRequest("languages.provideFormattingEdits", async (params, cancellation): Promise<IWireEditorEdit[]> => {
        const p: Received<IWireFormattingParams> = params;
        const handle = p.handle ?? -1;
        const range = p.range;
        let format:
            | ((
                  doc: vscode.TextDocument,
                  options: vscode.FormattingOptions,
                  token: vscode.CancellationToken,
              ) => vscode.ProviderResult<vscode.TextEdit[]>)
            | undefined;
        let owner: string | undefined;
        if (range === undefined) {
            const reg = formattingProviders.get(handle);
            if (reg !== undefined) {
                owner = reg.owner;
                format = (doc, options, token) => reg.provider.provideDocumentFormattingEdits(doc, options, token);
            }
        } else {
            const reg = rangeFormattingProviders.get(handle);
            if (reg !== undefined) {
                owner = reg.owner;
                const selection = toVscodeRange(range);
                format = (doc, options, token) =>
                    reg.provider.provideDocumentRangeFormattingEdits(doc, selection, options, token);
            }
        }
        if (format === undefined) return [];
        const doc = documentSync.resolve(p.uri, p.version, p.languageId);
        if (doc === null) return [];
        const options: vscode.FormattingOptions = {
            tabSize: p.tabSize ?? 4,
            insertSpaces: p.insertSpaces ?? true,
        };

        let result: unknown;
        try {
            result = await callWithVscodeToken(cancellation, (token) => format(doc, options, token));
        } catch (err) {
            // Сбой — пустой ответ (no-op), а не «нет форматтера»; в stderr — иначе он
            // неотличим от «менять нечего».
            reportProviderFailure(
                range === undefined ? "provideDocumentFormattingEdits" : "provideDocumentRangeFormattingEdits",
                err,
                owner,
            );
        }
        if (!Array.isArray(result)) return [];
        const edits: IWireEditorEdit[] = [];
        for (const item of result) {
            const wire = serializeTextEdit(item);
            if (wire !== null) edits.push(wire);
        }
        return edits;
    });

    // Контекст-диагностики собираются здесь из локальных DiagnosticCollection (с приватным
    // `data`, по которому сервер матчит фиксы), а не едут с хоста lossy-копией.
    rpc.handleRequest("languages.provideCodeActions", async (params, cancellation): Promise<WireCodeAction[]> => {
        const p: Received<IWireCodeActionParams, "range"> = params;
        const handle = p.handle ?? -1;
        const reg = codeActionProviders.get(handle);
        if (reg === undefined) return [];
        const doc = documentSync.resolve(p.uri, p.version, p.languageId);
        if (doc === null) return [];
        const range = toVscodeRange(p.range);
        const only = typeof p.only === "string" ? new CodeActionKind(p.only) : undefined;
        const context: vscode.CodeActionContext = {
            triggerKind: CodeActionTriggerKind.Invoke,
            diagnostics: diagnosticsIntersecting(doc.uri.toString(), range),
            only,
        };

        // Stryker disable next-line UpdateOperator: направление счётчика ненаблюдаемо — вёдра различает уникальность id, а не порядок
        const cacheId = nextCacheId++;
        const cached: ICachedCodeAction[] = [];
        const wire: WireCodeAction[] = [];
        let result: unknown;
        try {
            result = await callWithVscodeToken(cancellation, (token) =>
                reg.provider.provideCodeActions(doc, range, context, token),
            );
        } catch (err) {
            reportProviderFailure("provideCodeActions", err, reg.owner);
        }
        if (!Array.isArray(result)) return [];
        for (const item of result as unknown[]) {
            if (typeof (item as { title?: unknown } | null | undefined)?.title !== "string") continue;
            // Голые команды вида не имеют и при запрошенном `only` отбрасываются (как в VS Code).
            const action: CodeAction | undefined = item instanceof CodeAction ? item : undefined;
            const kind = action?.kind;
            // `kind` — публичное поле: расширение вправе положить туда что угодно.
            const kindValue: unknown = (kind as { value?: unknown } | null | undefined)?.value;
            const disabledReason: unknown = (action?.disabled as { reason?: unknown } | null | undefined)?.reason;
            if (only !== undefined && (kind === undefined || !only.contains(kind))) continue;
            const id = `${String(cacheId)}.${String(cached.length)}`;
            cached.push({ item: item as vscode.CodeAction | vscode.Command, registration: reg });
            wire.push({
                id,
                title: (item as { title: string }).title,
                ...(typeof kindValue === "string" ? { kind: kindValue } : {}),
                ...(action?.isPreferred === true ? { isPreferred: true } : {}),
                // Эталон: `typeConvert.CodeAction`, `disabled: action.disabled?.reason`.
                ...(typeof disabledReason === "string" ? { disabled: disabledReason } : {}),
            });
        }
        rememberCodeActions(cacheId, handle, cached);
        return wire;
    });

    // Ленивый resolve: правки многих серверов приезжают только по codeAction/resolve.
    rpc.handleRequest("languages.applyCodeAction", async (params, cancellation): Promise<boolean> => {
        const id: unknown = params.id;
        if (typeof id !== "string") return false;
        const found = findCachedCodeAction(id);
        if (found === null) return false;
        const owner = found.registration.owner;

        async function runActionCommand(command: vscode.Command): Promise<boolean> {
            try {
                await codeActionDeps.executeCommand(command.command, ...((command.arguments ?? []) as unknown[]));
                return true;
            } catch (err) {
                reportProviderFailure(`applyCodeAction command "${command.command}"`, err, owner);
                return false;
            }
        }

        if (!(found.item instanceof CodeAction)) {
            return runActionCommand(found.item as vscode.Command);
        }

        let action: CodeAction = found.item;
        const resolve = found.registration.provider.resolveCodeAction?.bind(found.registration.provider);
        // Stryker disable next-line ConditionalExpression: подмена на true вызвала бы отсутствующий resolve, но TypeError упал бы внутри try и был бы проглочен — ненаблюдаемо
        const canResolve = resolve !== undefined;
        if (action.edit === undefined && canResolve) {
            try {
                const resolved = await callWithVscodeToken(cancellation, (token) => resolve(action as never, token));
                if (resolved != null) action = resolved as CodeAction;
            } catch (err) {
                reportProviderFailure("resolveCodeAction", err, owner);
                // Сбойный resolve — применяем то, что есть (обычно command).
            }
        }

        let applied = false;
        if (action.edit instanceof WorkspaceEdit) {
            // Правки действия — рефакторинг (`files.refactoring.autoSave`),
            // кроме применённых конвейером сохранения: эталон снимает
            // `respectAutoSaveConfig` для `ApplyCodeActionReason.OnSave`.
            const ok = await codeActionDeps.applyEdit(action.edit, { isRefactoring: params.onSave !== true });
            // VS Code применяет edit ПЕРЕД командой: после отказа действие исполнилось бы наполовину.
            if (!ok) return false;
            applied = true;
        }
        const command = action.command;
        if (command !== undefined && typeof command.command === "string") {
            if (!(await runActionCommand(command))) return false;
            applied = true;
        }
        return applied;
    });

    rpc.handleRequest(
        "languages.provideCompletionItems",
        async (params, cancellation): Promise<ICoreCompletionResult[]> => {
            const p: Received<IWireCompletionParams> = params;
            const doc = documentSync.resolve(p.uri, p.version, p.languageId);
            if (doc === null) return [];
            const position = new Position(p.line ?? 0, p.character ?? 0);
            const context: vscode.CompletionContext = {
                triggerKind: p.triggerKind ?? CompletionTriggerKind.Invoke,
                triggerCharacter: p.triggerCharacter,
            };

            // Одно ведро кэша на пачку: id пунктов уникальны сквозь всех провайдеров.
            const cacheId = nextCacheId++;
            const cached: ICachedCompletion[] = [];
            const results: ICoreCompletionResult[] = [];
            for (const handle of Array.isArray(p.handles) ? p.handles : []) {
                if (cancellation.isCancellationRequested) break;
                const reg = completionProviders.get(handle as number);
                // Stryker disable next-line ConditionalExpression,BlockStatement: без проверки обращение к снятому провайдеру падает внутри try ниже, и провайдер получает тот же пустой результат
                if (reg === undefined) {
                    results.push({ items: [], isIncomplete: false });
                    continue;
                }
                const items: ICoreCompletionItem[] = [];
                let result: unknown;
                try {
                    result = await callWithVscodeToken(cancellation, (token) =>
                        reg.provider.provideCompletionItems(doc, position, token, context),
                    );
                } catch (err) {
                    reportProviderFailure("provideCompletionItems", err, reg.owner);
                }
                const normalized = normalizeResult(result);
                for (const item of normalized.items) {
                    // id выдаём ДО сериализации: resolve обязан получить тот же объект (у languageclient —
                    // ProtocolCompletionItem с приватным `data`).
                    const id = `${String(cacheId)}.${String(cached.length)}`;
                    const wire = serializeCompletionItem(item, id);
                    if (wire === null) continue;
                    cached.push({ item, provider: reg.provider, owner: reg.owner });
                    items.push(wire);
                }
                results.push({ items, isIncomplete: normalized.isIncomplete });
            }
            rememberCompletions(cacheId, cached);
            return results;
        },
    );

    // Стоковый languageclient объявляет серверу `resolveSupport` на detail/documentation/
    // additionalTextEdits — у tsserver в первом ответе их нет.
    rpc.handleRequest(
        "languages.resolveCompletionItem",
        async (params, cancellation): Promise<ICoreResolvedCompletion | null> => {
            const id: unknown = params.id;
            if (typeof id !== "string") return null;
            const entry = findCachedCompletion(id);
            if (entry === null) return null;
            const resolve = entry.provider.resolveCompletionItem?.bind(entry.provider);
            if (resolve === undefined) return null;

            let resolved: unknown;
            try {
                resolved = await callWithVscodeToken(cancellation, (token) => resolve(entry.item, token));
            } catch (err) {
                reportProviderFailure("resolveCompletionItem", err, entry.owner);
                return null;
            }
            const item = (resolved ?? entry.item) as vscode.CompletionItem;
            const detail = (item as { detail?: unknown }).detail;
            const documentation = readDocumentation(item);
            const additionalEdits = readAdditionalTextEdits(item);
            return {
                ...(typeof detail === "string" ? { detail } : {}),
                ...(documentation !== undefined ? { documentation } : {}),
                ...(additionalEdits.length > 0 ? { additionalEdits } : {}),
            };
        },
    );

    rpc.handleRequest(
        "languages.provideInlineCompletions",
        async (params, cancellation): Promise<ICoreInlineCompletionItem[][]> => {
            const p: Received<IWireInlineCompletionParams> = params;
            const doc = documentSync.resolve(p.uri, p.version, p.languageId);
            if (doc === null) return [];
            const position = new Position(p.line ?? 0, p.character ?? 0);
            // Один токен на пачку: провайдер (в первую очередь платный LLM) узнаёт об отмене,
            // languageclient превратит её в `$/cancelRequest` серверу.
            const cancel = toVscodeCancellationToken(cancellation);
            // selectedCompletionInfo не поддержан: при открытом suggest-попапе ядро ghost text
            // не запрашивает (docs/TODO/InlineCompletions.md).
            const context: vscode.InlineCompletionContext = {
                triggerKind: p.triggerKind ?? InlineCompletionTriggerKind.Automatic,
                selectedCompletionInfo: undefined,
            };

            const results: ICoreInlineCompletionItem[][] = [];
            try {
                for (const handle of Array.isArray(p.handles) ? p.handles : []) {
                    const items: ICoreInlineCompletionItem[] = [];
                    results.push(items);
                    if (cancel.token.isCancellationRequested) continue;
                    const reg = inlineCompletionProviders.get(handle as number);
                    // Stryker disable next-line ConditionalExpression: без проверки обращение к снятому провайдеру падает внутри try ниже, и провайдер получает тот же пустой список
                    if (reg === undefined) continue;
                    let result: unknown;
                    try {
                        result = await Promise.resolve(
                            reg.provider.provideInlineCompletionItems(doc, position, context, cancel.token),
                        );
                    } catch (err) {
                        reportProviderFailure("provideInlineCompletionItems", err, reg.owner);
                        // Своего `continue` нет намеренно: иначе ветка неотличима от проверки ниже.
                    }
                    if (result == null) continue;
                    const rawItems = Array.isArray(result) ? result : (result as { items?: unknown }).items;
                    if (!Array.isArray(rawItems)) continue;
                    for (const item of rawItems) {
                        const wire = serializeInlineCompletionItem(item);
                        if (wire !== null) items.push(wire);
                    }
                }
            } finally {
                // Stryker disable next-line CallExpression: уборка подписки, см. toVscodeCancellationToken
                cancel.dispose();
            }
            return results;
        },
    );

    rpc.handleRequest("languages.provideFoldingRanges", async (params, cancellation): Promise<WireFoldingRange[][]> => {
        const p: Received<IWireFoldingParams> = params;
        const doc = documentSync.resolve(p.uri, p.version, p.languageId);
        if (doc === null) return [];
        const context: vscode.FoldingContext = {};

        const results: WireFoldingRange[][] = [];
        for (const handle of Array.isArray(p.handles) ? p.handles : []) {
            if (cancellation.isCancellationRequested) break;
            const reg = foldingProviders.get(handle as number);
            const ranges: WireFoldingRange[] = [];
            results.push(ranges);
            // Stryker disable next-line ConditionalExpression: без проверки обращение к снятому провайдеру падает внутри try ниже, и провайдер получает тот же пустой список
            if (reg === undefined) continue;
            let result: unknown;
            try {
                result = await callWithVscodeToken(cancellation, (token) =>
                    reg.provider.provideFoldingRanges(doc, context, token),
                );
            } catch (err) {
                reportProviderFailure("provideFoldingRanges", err, reg.owner);
            }
            if (!Array.isArray(result)) continue;
            for (const range of result as vscode.FoldingRange[]) {
                const wire = serializeFoldingRange(range);
                if (wire !== null) ranges.push(wire);
            }
        }
        return results;
    });

    rpc.handleRequest(
        "languages.provideDocumentSemanticTokens",
        async (params, cancellation): Promise<WireSemanticTokensResult | null> => {
            const p: Received<IWireDocumentSemanticTokensParams> = params;
            const reg = semanticTokensProviders.get(p.handle ?? -1);
            if (reg === undefined) return null;
            const doc = documentSync.resolve(p.uri, p.version, p.languageId);
            if (doc === null) throw new CancellationError();
            try {
                return await callWithVscodeToken(cancellation, (token) =>
                    reg.adapter.provideDocumentSemanticTokens(doc, p.previousResultId ?? 0, token),
                );
            } catch (err) {
                reportProviderFailure("provideDocumentSemanticTokens", err, reg.owner);
                // Как в эталоне, отказ — исключением: на нём ядро держит прежние токены, а `null`
                // стёр бы подсветку. jdt.ls так отвечает на каждую правку (ContentModified).
                throw err;
            }
        },
    );

    rpc.handleRequest(
        "languages.provideDocumentRangeSemanticTokens",
        async (params, cancellation): Promise<WireSemanticTokensResult | null> => {
            const p: Received<IWireRangeSemanticTokensParams, "range"> = params;
            const reg = rangeSemanticTokensProviders.get(p.handle ?? -1);
            if (reg === undefined) return null;
            const doc = documentSync.resolve(p.uri, p.version, p.languageId);
            if (doc === null) throw new CancellationError();
            try {
                return await callWithVscodeToken(cancellation, (token) =>
                    reg.adapter.provideDocumentRangeSemanticTokens(doc, toVscodeRange(p.range), token),
                );
            } catch (err) {
                reportProviderFailure("provideDocumentRangeSemanticTokens", err, reg.owner);
                // Как в эталоне, отказ — исключением: на нём ядро держит прежние токены, а `null`
                // стёр бы подсветку. jdt.ls так отвечает на каждую правку (ContentModified).
                throw err;
            }
        },
    );

    rpc.handleNotification("languages.releaseDocumentSemanticTokens", (params) => {
        const p = (params as Partial<IWireReleaseSemanticTokens> | null | undefined) ?? {};
        semanticTokensProviders.get(p.handle ?? -1)?.adapter.releaseDocumentSemanticColoring(p.resultId ?? 0);
    });

    function registerSemanticTokens<T extends { readonly selector: vscode.DocumentSelector }>(
        providers: Map<number, Owned<T>>,
        kind: "semanticTokens" | "rangeSemanticTokens",
        registration: T,
        onDidChange: vscode.Event<void> | undefined,
        legend: vscode.SemanticTokensLegend,
    ): vscode.Disposable {
        const hasOnDidChange = typeof onDidChange === "function";
        return registerByHandle(
            providers,
            kind,
            registration.selector,
            registration,
            {
                legend: { tokenTypes: [...legend.tokenTypes], tokenModifiers: [...legend.tokenModifiers] },
                ...(hasOnDidChange ? { hasOnDidChange } : {}),
            },
            undefined,
            (handle) =>
                onDidChange?.(() => {
                    rpc.notify("languages.didChangeSemanticTokens", { handle });
                }),
        );
    }

    // Стоковый клиент заводит провайдеры под capabilities сервера: no-op — валидный
    // Disposable, чтобы он не падал. Готовность — docs/public/API-COVERAGE.md.
    const registerNoopProvider = (): vscode.Disposable => new DisposableImpl(() => undefined);

    const createDiagnosticCollection = (name?: string): vscode.DiagnosticCollection => {
        // Ключ MarkerService уникален на коллекцию, иначе одноимённые коллекции затирали бы
        // маркеры друг друга; повтор базы получает счётчик (`_idPool` ExtHostDiagnostics).
        const extensionId = ctx.owner.current;
        const base = `ext:${extensionId === undefined ? "" : `${extensionId}:`}${name ?? "diagnostics"}`;
        const taken = diagnosticOwnerCounts.get(base) ?? 0;
        diagnosticOwnerCounts.set(base, taken + 1);
        const owner = taken === 0 ? base : `${base}#${String(taken)}`;
        const store = new Map<string, readonly vscode.Diagnostic[]>();
        diagnosticStores.add(store);

        const resourceOf = (uri: unknown): string => {
            if (typeof uri === "string") return Uri.parse(uri).toString();
            return (uri as { toString(): string }).toString();
        };
        const publish = (resource: string, diags: readonly vscode.Diagnostic[]): void => {
            const markers = diags.map(toWireMarker).filter((marker) => marker !== null);
            rpc.notify("diagnostics.publish", { owner, resource, markers });
        };
        const setOne = (uri: unknown, diags: readonly vscode.Diagnostic[] | undefined): void => {
            const resource = resourceOf(uri);
            store.set(resource, diags ?? []);
            publish(resource, diags ?? []);
            diagnosticsChangedFor([resource]);
        };

        // `unknown`, а не `Uri`: JS-расширение вправе прислать строку.
        const collection: vscode.DiagnosticCollection = {
            name: name ?? "diagnostics",
            set: (arg: unknown, diags?: readonly vscode.Diagnostic[]): void => {
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
                diagnosticsChangedFor([resource]);
            },
            clear: (): void => {
                for (const resource of store.keys()) publish(resource, []);
                diagnosticsChangedFor([...store.keys()]);
                store.clear();
            },
            forEach: (
                callback: (
                    uri: vscode.Uri,
                    diagnostics: readonly vscode.Diagnostic[],
                    c: vscode.DiagnosticCollection,
                ) => unknown,
                thisArg?: unknown,
            ): void => {
                for (const [resource, diags] of store) callback.call(thisArg, Uri.parse(resource), diags, collection);
            },
            get: (uri: unknown): readonly vscode.Diagnostic[] | undefined => store.get(resourceOf(uri)),
            has: (uri: unknown): boolean => store.has(resourceOf(uri)),
            dispose: (): void => {
                collection.clear();
                diagnosticStores.delete(store);
            },
            *[Symbol.iterator](): IterableIterator<[vscode.Uri, readonly vscode.Diagnostic[]]> {
                for (const [resource, diags] of store) yield [Uri.parse(resource), diags];
            },
        };
        return collection;
    };

    const languagesNs = {
        onDidChangeDiagnostics: diagnosticsChanged.event,
        getDiagnostics,
        createDiagnosticCollection,
        // В UI не проецируется (в статус-баре нет места); Ruff держит в нём состояние сервера.
        createLanguageStatusItem: (id: string, selector: vscode.DocumentSelector): vscode.LanguageStatusItem => ({
            id,
            selector,
            name: undefined,
            text: "",
            detail: undefined,
            severity: 0,
            command: undefined,
            busy: false,
            dispose: () => undefined,
        }),
        // Настоящий match: languageclient фильтрует им документы для синхронизации — наивный
        // «всегда 10» скармливал ts-серверу markdown, и тот ронял хендлеры.
        match: (selector: vscode.DocumentSelector, document: vscode.TextDocument): number =>
            scoreDocumentSelector(selector, document),

        registerCompletionItemProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.CompletionItemProvider,
            ...triggerCharacters: string[]
        ): vscode.Disposable => {
            // Триггер-символы едут метаданными: ядро берёт их только у провайдеров, подошедших документу.
            const registration: ICompletionRegistration = { selector, provider, triggerCharacters };
            return registerByHandle(completionProviders, "completion", selector, registration, {
                triggerCharacters: triggerCharacters.filter((char) => typeof char === "string" && char !== ""),
            });
        },
        registerFoldingRangeProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.FoldingRangeProvider,
        ): vscode.Disposable => registerByHandle(foldingProviders, "folding", selector, { selector, provider }),
        registerDefinitionProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.DefinitionProvider,
        ): vscode.Disposable => registerByHandle(definitionProviders, "definition", selector, { selector, provider }),
        registerHoverProvider: (selector: vscode.DocumentSelector, provider: vscode.HoverProvider): vscode.Disposable =>
            registerByHandle(hoverProviders, "hover", selector, { selector, provider }),
        registerReferenceProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.ReferenceProvider,
        ): vscode.Disposable => registerByHandle(referenceProviders, "references", selector, { selector, provider }),
        registerRenameProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.RenameProvider,
        ): vscode.Disposable => registerByHandle(renameProviders, "rename", selector, { selector, provider }),

        registerSignatureHelpProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.SignatureHelpProvider,
            ...rest: (string | vscode.SignatureHelpProviderMetadata)[]
        ): vscode.Disposable => {
            const registration: ISignatureHelpRegistration = { selector, provider, ...readSignatureHelpMetadata(rest) };
            return registerByHandle(signatureHelpProviders, "signatureHelp", selector, registration, {
                triggerCharacters: registration.triggerCharacters,
                retriggerCharacters: registration.retriggerCharacters,
            });
        },

        registerDocumentFormattingEditProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.DocumentFormattingEditProvider,
        ): vscode.Disposable => registerByHandle(formattingProviders, "formatting", selector, { selector, provider }),

        registerDocumentRangeFormattingEditProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.DocumentRangeFormattingEditProvider,
        ): vscode.Disposable =>
            registerByHandle(rangeFormattingProviders, "rangeFormatting", selector, { selector, provider }),

        registerCodeActionsProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.CodeActionProvider,
            metadata?: vscode.CodeActionProviderMetadata,
        ): vscode.Disposable => {
            // Stryker disable next-line ArrayDeclaration: фолбэк-массив тут же вычищается map+filter — содержимое ненаблюдаемо
            const providedKinds = (metadata?.providedCodeActionKinds ?? [])
                .map((kind) => (kind as { value?: unknown }).value)
                .filter((value): value is string => typeof value === "string");
            const registration: ICodeActionRegistration = { selector, provider, providedKinds };
            return registerByHandle(
                codeActionProviders,
                "codeActions",
                selector,
                registration,
                { providedCodeActionKinds: providedKinds },
                forgetCodeActions,
            );
        },

        registerDeclarationProvider: registerNoopProvider,
        registerImplementationProvider: registerNoopProvider,
        registerTypeDefinitionProvider: registerNoopProvider,
        registerDocumentHighlightProvider: registerNoopProvider,
        registerDocumentSymbolProvider: registerNoopProvider,
        registerWorkspaceSymbolProvider: registerNoopProvider,
        registerCodeLensProvider: registerNoopProvider,
        registerDocumentLinkProvider: registerNoopProvider,
        registerColorProvider: registerNoopProvider,
        registerOnTypeFormattingEditProvider: registerNoopProvider,
        registerSelectionRangeProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.SelectionRangeProvider,
        ): vscode.Disposable =>
            registerByHandle(selectionRangeProviders, "selectionRange", selector, { selector, provider }),
        registerDocumentSemanticTokensProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.DocumentSemanticTokensProvider,
            legend: vscode.SemanticTokensLegend,
        ): vscode.Disposable =>
            registerSemanticTokens(
                semanticTokensProviders,
                "semanticTokens",
                { selector, adapter: new DocumentSemanticTokensAdapter(provider) },
                provider.onDidChangeSemanticTokens,
                legend,
            ),
        registerDocumentRangeSemanticTokensProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.DocumentRangeSemanticTokensProvider,
            legend: vscode.SemanticTokensLegend,
        ): vscode.Disposable =>
            registerSemanticTokens(
                rangeSemanticTokensProviders,
                "rangeSemanticTokens",
                { selector, adapter: new DocumentRangeSemanticTokensAdapter(provider) },
                provider.onDidChangeSemanticTokens,
                legend,
            ),
        registerInlayHintsProvider: registerNoopProvider,
        registerInlineValuesProvider: registerNoopProvider,
        registerInlineCompletionItemProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.InlineCompletionItemProvider,
        ): vscode.Disposable =>
            registerByHandle(inlineCompletionProviders, "inlineCompletions", selector, { selector, provider }),
        registerLinkedEditingRangeProvider: registerNoopProvider,
        registerCallHierarchyProvider: registerNoopProvider,
        registerTypeHierarchyProvider: registerNoopProvider,
        setLanguageConfiguration: createSetLanguageConfiguration(ctx),
    };

    return {
        languages: implementsApi<typeof vscode.languages>()(languagesNs),
    };
}
