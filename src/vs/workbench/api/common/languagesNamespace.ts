import type * as vscode from "vscode";

import { CancellationTokenNone, type ICancellationToken } from "../../../base/common/cancellation.ts";
import { describeRejection } from "../../../base/common/describeRejection.ts";
import { CancellationError, isCancellationError } from "../../../base/common/errorSerialization.ts";
import type { IRange } from "../../../editor/common/core/iRange.ts";
import type { IColorInformation } from "../../../editor/common/languages/iColorSource.ts";
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
import { createLanguageStatusItemFactory } from "./extHostLanguageStatus.ts";
import { DocumentRangeSemanticTokensAdapter, DocumentSemanticTokensAdapter } from "./extHostSemanticTokens.ts";
import {
    rangeFrom,
    readAdditionalTextEdits,
    readDocumentation,
    serializeCompletionItem,
    serializeDefinitionLocation,
    serializeDocumentColors,
    serializeDocumentHighlights,
    serializeFoldingRange,
    serializeHoverContents,
    serializeInlayHints,
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
    CompletionItem,
    CompletionList,
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
    IWireDocumentColorParams,
    IWireDocumentHighlight,
    IWireDocumentHighlightParams,
    IWireDocumentSemanticTokensParams,
    IWireEditorEdit,
    IWireFoldingParams,
    IWireForeignMarkers,
    IWireFormattingParams,
    IWireHoverParams,
    IWireInlayHint,
    IWireInlayHintsParams,
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

export interface IInlayHintsRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.InlayHintsProvider;
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

export interface IImplementationRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.ImplementationProvider;
}

export interface ITypeDefinitionRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.TypeDefinitionProvider;
}

export interface IDeclarationRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.DeclarationProvider;
}

export interface IRenameRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.RenameProvider;
}

export interface IDocumentHighlightRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.DocumentHighlightProvider;
}

export interface ISelectionRangeRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.SelectionRangeProvider;
}

export interface IColorRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.DocumentColorProvider;
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

/** `undefined` means the registration happened outside an extension overlay. */
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

/** Upstream ExtHostDiagnostics DebounceEmitter `delay`. */
const DIAGNOSTICS_CHANGE_DELAY_MS = 50;

interface ICachedCodeAction {
    readonly item: vscode.CodeAction | vscode.Command;
    readonly registration: Owned<ICodeActionRegistration>;
}

/** Bounds are inclusive (like `vscode.Range.intersection`). */
function rangesIntersect(a: Range, b: Range): boolean {
    const startsBeforeOrAt = (x: Position, y: Position): boolean =>
        x.line < y.line || (x.line === y.line && x.character <= y.character);
    return startsBeforeOrAt(a.start, b.end) && startsBeforeOrAt(b.start, a.end);
}

/** A provider may reject the promise with anything, not only an `Error`. */
function renameRejectReason(error: unknown): string {
    if (typeof error === "string" && error !== "") return error;
    const message = (error as { message?: unknown } | null | undefined)?.message;
    if (typeof message === "string" && message !== "") return message;
    return "Rename failed";
}

/**
 * A metadata object (the stock client passes it when the server sent
 * `retriggerCharacters`) or rest strings of trigger characters.
 */
function readSignatureHelpMetadata(rest: readonly unknown[]): {
    triggerCharacters: readonly string[];
    retriggerCharacters: readonly string[];
} {
    const first = rest.at(0);
    // Stryker disable next-line ConditionalExpression: the client never passes `null` as the third argument, and if it did both branches would yield empty character lists
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
 * `isIncomplete` is not cosmetic: it makes the core re-query providers when a character is
 * typed instead of filtering locally (tsserver's list is almost always incomplete).
 */
function normalizeResult(result: unknown): { items: readonly vscode.CompletionItem[]; isIncomplete: boolean } {
    if (result === undefined || result === null) return { items: [], isIncomplete: false };
    if (Array.isArray(result)) return { items: result as vscode.CompletionItem[], isIncomplete: false };
    const items = (result as { items?: unknown }).items;
    const isIncomplete = (result as { isIncomplete?: unknown }).isIncomplete === true;
    return { items: Array.isArray(items) ? (items as vscode.CompletionItem[]) : [], isIncomplete };
}

/**
 * A provider failure doesn't break the command, but isn't silent either: a silent failure of the
 * stock prettier looked like "nothing to change" and left no trace in any log (#381).
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
    // Stryker disable next-line ArrowFunction: `undefined` and `Promise<false>` are indistinguishable for applyCodeAction — both read as "not applied"
    applyEdit: () => Promise.resolve(false),
    executeCommand: () => Promise.reject(new Error("commands bridge is not wired")),
};

/** What the `vscode.execute*Provider` API commands run: the extension's own providers, results in API types. */
export interface ILanguageProviderExecutors {
    completionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        triggerCharacter: string | undefined,
        itemResolveCount: number | undefined,
    ): Promise<vscode.CompletionList>;
    codeActions(
        document: vscode.TextDocument,
        range: vscode.Range,
        kind: string | undefined,
        itemResolveCount: number | undefined,
    ): Promise<(vscode.CodeAction | vscode.Command)[]>;
}

export function createLanguagesNamespace(
    ctx: IVscodeHostContext,
    codeActionDeps: ICodeActionDeps = NULL_CODE_ACTION_DEPS,
): {
    languages: typeof vscode.languages;
    executeProviders: ILanguageProviderExecutors;
} {
    const { rpc, documentSync } = ctx;
    // By the handle from the core request (like upstream ExtHostLanguageFeatures._adapter).
    const hoverProviders = new Map<number, Owned<IHoverRegistration>>();
    const definitionProviders = new Map<number, Owned<IDefinitionRegistration>>();
    const implementationProviders = new Map<number, Owned<IImplementationRegistration>>();
    const typeDefinitionProviders = new Map<number, Owned<ITypeDefinitionRegistration>>();
    const declarationProviders = new Map<number, Owned<IDeclarationRegistration>>();
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
    const documentHighlightProviders = new Map<number, Owned<IDocumentHighlightRegistration>>();
    const colorProviders = new Map<number, Owned<IColorRegistration>>();
    const inlayHintsProviders = new Map<number, Owned<IInlayHintsRegistration>>();
    const semanticTokensProviders = new Map<number, Owned<IDocumentSemanticTokensRegistration>>();
    const rangeSemanticTokensProviders = new Map<number, Owned<IRangeSemanticTokensRegistration>>();
    let nextProviderHandle = 0;

    /** The core scores selectors: the subprocess is called with the already chosen handle. */
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
        // Capture the owner now: the overlay sets it only for the duration of the
        // synchronous `register*`, while a provider failure happens much later.
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

    // Depth COMPLETION_CACHE_DEPTH: a "response arrived, popup already re-queried" race
    // costs one extra bucket.
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

    // The action applied must be THE SAME object the provider returned (in the client it is a
    // ProtocolCodeAction with private `data`). Depth is per provider, like upstream
    // (`CodeActionAdapter._cache`): a shared depth of 2 with three providers evicted
    // the fastest one's bucket before an item was picked — "Code action failed".
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

    // The code actions context holds THE SAME Diagnostic objects the client published.
    const diagnosticStores = new Set<Map<string, readonly vscode.Diagnostic[]>>();
    // MarkerService keys are never reused: a counter per key base.
    const diagnosticOwnerCounts = new Map<string, number>();
    // Mirror of foreign markers — upstream `_mirrorCollection`.
    const mirrorStore = new Map<string, readonly vscode.Diagnostic[]>();

    // Like upstream DebounceEmitter: the first change opens the window, the accumulated changes go
    // out as one event with unique resources in order of first appearance.
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
        // Like upstream, the mirror joins the set on the first message — after the collections
        // already created.
        diagnosticStores.add(mirrorStore);
        for (const { resource, markers } of entries) mirrorStore.set(resource, markers.map(toVscodeDiagnostic));
        diagnosticsChangedFor(entries.map((entry) => entry.resource));
    });

    function getDiagnostics(resource: vscode.Uri): vscode.Diagnostic[];
    function getDiagnostics(): [vscode.Uri, vscode.Diagnostic[]][];
    // `null` from a JS extension means "no resource" (upstream checks for truthy).
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
            // Stryker disable next-line ArrayDeclaration: the fallback array is immediately filtered by range — its contents are unobservable
            for (const diag of store.get(resource) ?? []) {
                const diagRange = (diag as { range?: Range }).range;
                if (diagRange === undefined) continue;
                if (rangesIntersect(diagRange, range)) found.push(diag);
            }
        }
        return found;
    }

    /** The shared body of the go-to requests: the result is `Definition | DefinitionLink[]`. */
    async function provideLocations<T>(
        params: Received<IWireDefinitionParams>,
        cancellation: ICancellationToken,
        providers: Map<number, Owned<T>>,
        method: string,
        call: (
            reg: T,
            doc: ExtHostTextDocument,
            position: Position,
            token: vscode.CancellationToken,
        ) => vscode.ProviderResult<vscode.Definition | vscode.DefinitionLink[]>,
    ): Promise<ICoreDefinitionLocation[]> {
        const reg = providers.get(params.handle ?? -1);
        if (reg === undefined) return [];
        const doc = documentSync.resolve(params.uri, params.version, params.languageId);
        if (doc === null) return [];
        const position = new Position(params.line ?? 0, params.character ?? 0);
        let result: unknown;
        try {
            result = await callWithVscodeToken(cancellation, (token) => call(reg, doc, position, token));
        } catch (err) {
            reportProviderFailure(method, err, reg.owner);
        }
        const locations: ICoreDefinitionLocation[] = [];
        for (const item of Array.isArray(result) ? result : [result]) {
            const wire = serializeDefinitionLocation(item);
            if (wire !== null) locations.push(wire);
        }
        return locations;
    }

    rpc.handleRequest("languages.provideDefinition", (params, cancellation) =>
        provideLocations(
            params,
            cancellation,
            definitionProviders,
            "provideDefinition",
            ({ provider }, doc, position, token) => provider.provideDefinition(doc, position, token),
        ),
    );

    rpc.handleRequest("languages.provideImplementation", (params, cancellation) =>
        provideLocations(
            params,
            cancellation,
            implementationProviders,
            "provideImplementation",
            ({ provider }, doc, position, token) => provider.provideImplementation(doc, position, token),
        ),
    );

    rpc.handleRequest("languages.provideTypeDefinition", (params, cancellation) =>
        provideLocations(
            params,
            cancellation,
            typeDefinitionProviders,
            "provideTypeDefinition",
            ({ provider }, doc, position, token) => provider.provideTypeDefinition(doc, position, token),
        ),
    );

    rpc.handleRequest("languages.provideDeclaration", (params, cancellation) =>
        provideLocations(
            params,
            cancellation,
            declarationProviders,
            "provideDeclaration",
            ({ provider }, doc, position, token) => provider.provideDeclaration(doc, position, token),
        ),
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

    rpc.handleRequest(
        "languages.provideDocumentHighlights",
        async (params, cancellation): Promise<IWireDocumentHighlight[] | null> => {
            const p: Received<IWireDocumentHighlightParams> = params;
            const reg = documentHighlightProviders.get(p.handle ?? -1);
            if (reg === undefined) return null;
            const doc = documentSync.resolve(p.uri, p.version, p.languageId);
            if (doc === null) return null;
            const position = new Position(p.line ?? 0, p.character ?? 0);
            let result: unknown;
            try {
                result = await callWithVscodeToken(cancellation, (token) =>
                    reg.provider.provideDocumentHighlights(doc, position, token),
                );
            } catch (err) {
                reportProviderFailure("provideDocumentHighlights", err, reg.owner);
            }
            return serializeDocumentHighlights(result);
        },
    );

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
        "languages.provideDocumentColors",
        async (params, cancellation): Promise<IColorInformation[] | null> => {
            const p: Received<IWireDocumentColorParams> = params;
            // The provider may have been removed while the request was in flight: "no colors".
            const reg = colorProviders.get(p.handle ?? -1);
            if (reg === undefined) return null;
            const doc = documentSync.resolve(p.uri, p.version, p.languageId);
            if (doc === null) return null;
            let result: unknown;
            try {
                result = await callWithVscodeToken(cancellation, (token) =>
                    reg.provider.provideDocumentColors(doc, token),
                );
            } catch (err) {
                reportProviderFailure("provideDocumentColors", err, reg.owner);
            }
            return serializeDocumentColors(result);
        },
    );

    rpc.handleRequest("languages.provideInlayHints", async (params, cancellation): Promise<IWireInlayHint[] | null> => {
        const p: Received<IWireInlayHintsParams, "range"> = params;
        // The provider may have been removed while the request was in flight: "no hints".
        const reg = inlayHintsProviders.get(p.handle ?? -1);
        if (reg === undefined) return null;
        const doc = documentSync.resolve(p.uri, p.version, p.languageId);
        if (doc === null) return null;
        let result: unknown;
        try {
            result = await callWithVscodeToken(cancellation, (token) =>
                reg.provider.provideInlayHints(doc, toVscodeRange(p.range), token),
            );
        } catch (err) {
            reportProviderFailure("provideInlayHints", err, reg.owner);
        }
        return serializeInlayHints(result, p.range);
    });

    rpc.handleRequest(
        "languages.provideSignatureHelp",
        async (params, cancellation): Promise<ICoreSignatureHelp | null> => {
            // Everything but `uri` is optional: the defaults below handle a field lost over RPC.
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
        // No `prepareRename` is not a refusal: upstream renames the word under the cursor,
        // and the core decides what counts as a word.
        if (prepare === undefined) return null;
        const target = syncRenameTarget(p);
        if (target === null) return null;
        const { doc, position } = target;
        let result: unknown;
        try {
            result = await callWithVscodeToken(cancellation, (token) => prepare(doc, position, token));
        } catch (error) {
            // Upstream expresses "can't rename here" by rejecting the promise — an answer, not a failure.
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
            // A rejected promise is upstream's regular "invalid name" channel: the message goes to the user.
            return { applied: false, error: renameRejectReason(error) };
        }
        if (!(edit instanceof WorkspaceEdit)) return { applied: false };
        // Rename is a refactoring: upstream uses `respectAutoSaveConfig: true`.
        const ok = await codeActionDeps.applyEdit(edit, { isRefactoring: true });
        return ok ? { applied: true } : { applied: false, error: "Rename failed to apply edits" };
    });

    // One RPC for both kinds (#196): with `range` it's the range provider (including formatting a
    // document with a range provider over the full range), without it the document one.
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
            // A failure is an empty answer (no-op), not "no formatter"; log to stderr, otherwise it is
            // indistinguishable from "nothing to change".
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

    // Context diagnostics are collected here from local DiagnosticCollections (with private
    // `data` the server matches fixes by) rather than shipped from the host as a lossy copy.
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

        // Stryker disable next-line UpdateOperator: the counter direction is unobservable — buckets are told apart by id uniqueness, not order
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
            // Bare commands have no kind and are dropped when `only` is requested (as in VS Code).
            const action: CodeAction | undefined = item instanceof CodeAction ? item : undefined;
            const kind = action?.kind;
            // `kind` is a public field: an extension may put anything there.
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
                // Upstream: `typeConvert.CodeAction`, `disabled: action.disabled?.reason`.
                ...(typeof disabledReason === "string" ? { disabled: disabledReason } : {}),
            });
        }
        rememberCodeActions(cacheId, handle, cached);
        return wire;
    });

    // Lazy resolve: many servers deliver edits only via codeAction/resolve.
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
        // Stryker disable next-line ConditionalExpression: replacing with true would call a missing resolve, but the TypeError would be thrown inside the try and swallowed — unobservable
        const canResolve = resolve !== undefined;
        if (action.edit === undefined && canResolve) {
            try {
                const resolved = await callWithVscodeToken(cancellation, (token) => resolve(action as never, token));
                if (resolved != null) action = resolved as CodeAction;
            } catch (err) {
                reportProviderFailure("resolveCodeAction", err, owner);
                // Failed resolve: apply what we have (usually the command).
            }
        }

        let applied = false;
        if (action.edit instanceof WorkspaceEdit) {
            // Action edits are a refactoring (`files.refactoring.autoSave`),
            // except those applied by the save pipeline: upstream drops
            // `respectAutoSaveConfig` for `ApplyCodeActionReason.OnSave`.
            const ok = await codeActionDeps.applyEdit(action.edit, { isRefactoring: params.onSave !== true });
            // VS Code applies the edit BEFORE the command: after a refusal the action would run only halfway.
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

            // One cache bucket per batch: item ids are unique across all providers.
            const cacheId = nextCacheId++;
            const cached: ICachedCompletion[] = [];
            const results: ICoreCompletionResult[] = [];
            for (const handle of Array.isArray(p.handles) ? p.handles : []) {
                if (cancellation.isCancellationRequested) break;
                const reg = completionProviders.get(handle as number);
                // Stryker disable next-line ConditionalExpression,BlockStatement: without the check, accessing the removed provider throws inside the try below, and the provider gets the same empty result
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
                    // Assign the id BEFORE serialization: resolve must get the same object (in languageclient a
                    // ProtocolCompletionItem with private `data`).
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

    // The stock languageclient declares `resolveSupport` for detail/documentation/
    // additionalTextEdits to the server — tsserver's first response lacks them.
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
            // One token per batch: the provider (above all a paid LLM) learns about cancellation,
            // and languageclient turns it into a `$/cancelRequest` to the server.
            const cancel = toVscodeCancellationToken(cancellation);
            // selectedCompletionInfo is not supported: with the suggest popup open the core doesn't
            // request ghost text (docs/TODO/InlineCompletions.md).
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
                    // Stryker disable next-line ConditionalExpression: without the check, accessing the removed provider throws inside the try below, and the provider gets the same empty list
                    if (reg === undefined) continue;
                    let result: unknown;
                    try {
                        result = await Promise.resolve(
                            reg.provider.provideInlineCompletionItems(doc, position, context, cancel.token),
                        );
                    } catch (err) {
                        reportProviderFailure("provideInlineCompletionItems", err, reg.owner);
                        // No own `continue` on purpose: otherwise the branch is indistinguishable from the check below.
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
                // Stryker disable next-line CallExpression: subscription cleanup, see toVscodeCancellationToken
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
            // Stryker disable next-line ConditionalExpression: without the check, accessing the removed provider throws inside the try below, and the provider gets the same empty list
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
                // Like upstream, a refusal is thrown: the core then keeps the previous tokens, while `null`
                // would wipe the highlighting. jdt.ls answers this way on every edit (ContentModified).
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
                // Like upstream, a refusal is thrown: the core then keeps the previous tokens, while `null`
                // would wipe the highlighting. jdt.ls answers this way on every edit (ContentModified).
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

    // The stock client registers providers per server capabilities: a no-op is a valid
    // Disposable so it doesn't crash. Readiness: docs/public/API-COVERAGE.md.
    const registerNoopProvider = (): vscode.Disposable => new DisposableImpl(() => undefined);

    const createDiagnosticCollection = (name?: string): vscode.DiagnosticCollection => {
        // The MarkerService key is unique per collection, otherwise same-named collections would overwrite
        // each other's markers; a repeated base gets a counter (`_idPool` of ExtHostDiagnostics).
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

        // `unknown`, not `Uri`: a JS extension may send a string.
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
        getLanguages: async (): Promise<string[]> => [...(await rpc.request("languages.getLanguages"))],
        setTextDocumentLanguage: async (
            document: vscode.TextDocument,
            languageId: string,
        ): Promise<vscode.TextDocument> => {
            const { applied } = await rpc.request("languages.changeLanguage", {
                uri: document.uri.toString(),
                languageId,
            });
            if (!applied) documentSync.changeLanguage(document as ExtHostTextDocument, languageId);
            return document;
        },
        onDidChangeDiagnostics: diagnosticsChanged.event,
        getDiagnostics,
        createDiagnosticCollection,
        createLanguageStatusItem: createLanguageStatusItemFactory(ctx),
        // A real match: languageclient uses it to filter documents for sync — a naive
        // "always 10" fed markdown to the ts server, which crashed its handlers.
        match: (selector: vscode.DocumentSelector, document: vscode.TextDocument): number =>
            scoreDocumentSelector(selector, document),

        registerCompletionItemProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.CompletionItemProvider,
            ...triggerCharacters: string[]
        ): vscode.Disposable => {
            // Trigger characters ride as metadata: the core takes them only from providers matching the document.
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
        registerImplementationProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.ImplementationProvider,
        ): vscode.Disposable =>
            registerByHandle(implementationProviders, "implementation", selector, { selector, provider }),
        registerTypeDefinitionProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.TypeDefinitionProvider,
        ): vscode.Disposable =>
            registerByHandle(typeDefinitionProviders, "typeDefinition", selector, { selector, provider }),
        registerDeclarationProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.DeclarationProvider,
        ): vscode.Disposable => registerByHandle(declarationProviders, "declaration", selector, { selector, provider }),
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
            // Stryker disable next-line ArrayDeclaration: the fallback array is immediately cleaned by map+filter — its contents are unobservable
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

        registerDocumentHighlightProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.DocumentHighlightProvider,
        ): vscode.Disposable =>
            registerByHandle(documentHighlightProviders, "documentHighlight", selector, { selector, provider }),
        registerDocumentSymbolProvider: registerNoopProvider,
        registerWorkspaceSymbolProvider: registerNoopProvider,
        registerCodeLensProvider: registerNoopProvider,
        registerDocumentLinkProvider: registerNoopProvider,
        registerColorProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.DocumentColorProvider,
        ): vscode.Disposable => registerByHandle(colorProviders, "color", selector, { selector, provider }),
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
        registerInlayHintsProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.InlayHintsProvider,
        ): vscode.Disposable => {
            const onDidChange = provider.onDidChangeInlayHints;
            return registerByHandle(
                inlayHintsProviders,
                "inlayHints",
                selector,
                { selector, provider },
                typeof onDidChange === "function" ? { hasOnDidChange: true } : {},
                undefined,
                (handle) =>
                    onDidChange?.(() => {
                        rpc.notify("languages.didChangeInlayHints", { handle });
                    }),
            );
        },
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

    /** Best match first, as upstream's `LanguageFeatureRegistry.ordered`. */
    function matching<T extends { readonly selector: vscode.DocumentSelector }>(
        providers: ReadonlyMap<number, T>,
        document: vscode.TextDocument,
    ): T[] {
        return [...providers.values()]
            .map((registration) => ({ registration, rank: scoreDocumentSelector(registration.selector, document) }))
            .filter(({ rank }) => rank > 0)
            .sort((a, b) => b.rank - a.rank)
            .map(({ registration }) => registration);
    }

    const executeProviders: ILanguageProviderExecutors = {
        completionItems: async (document, position, triggerCharacter, itemResolveCount = 0) => {
            const context: vscode.CompletionContext = {
                triggerKind:
                    triggerCharacter === undefined
                        ? CompletionTriggerKind.Invoke
                        : CompletionTriggerKind.TriggerCharacter,
                triggerCharacter,
            };
            const found: { item: vscode.CompletionItem; registration: Owned<ICompletionRegistration> }[] = [];
            let isIncomplete = false;
            for (const registration of matching(completionProviders, document)) {
                let result: unknown;
                try {
                    result = await callWithVscodeToken(CancellationTokenNone, (token) =>
                        registration.provider.provideCompletionItems(document, position, token, context),
                    );
                } catch (err) {
                    reportProviderFailure("provideCompletionItems", err, registration.owner);
                }
                const normalized = normalizeResult(result);
                isIncomplete ||= normalized.isIncomplete;
                for (const item of normalized.items) found.push({ item, registration });
            }
            const items = await Promise.all(
                found.map(async ({ item, registration }, index) => {
                    if (index >= itemResolveCount) return item;
                    const { provider } = registration;
                    const resolved = await callWithVscodeToken(CancellationTokenNone, (token) =>
                        provider.resolveCompletionItem?.(item, token),
                    );
                    return resolved ?? item;
                }),
            );
            return new CompletionList(items as CompletionItem[], isIncomplete);
        },
        codeActions: async (document, range, kind, itemResolveCount = 0) => {
            const only = kind === undefined ? undefined : new CodeActionKind(kind);
            const context: vscode.CodeActionContext = {
                triggerKind: CodeActionTriggerKind.Invoke,
                diagnostics: diagnosticsIntersecting(document.uri.toString(), range),
                only,
            };
            const found: { item: vscode.CodeAction | vscode.Command; provider: vscode.CodeActionProvider }[] = [];
            for (const registration of matching(codeActionProviders, document)) {
                let result: unknown;
                try {
                    result = await callWithVscodeToken(CancellationTokenNone, (token) =>
                        registration.provider.provideCodeActions(document, range, context, token),
                    );
                } catch (err) {
                    reportProviderFailure("provideCodeActions", err, registration.owner);
                }
                if (!Array.isArray(result)) continue;
                for (const item of result as (vscode.CodeAction | vscode.Command)[]) {
                    if (typeof (item as { title?: unknown } | null | undefined)?.title !== "string") continue;
                    // Bare commands have no kind and are dropped when a kind is asked for, as upstream.
                    const itemKind = item instanceof CodeAction ? item.kind : undefined;
                    if (only !== undefined && (itemKind === undefined || !only.contains(itemKind))) continue;
                    found.push({ item, provider: registration.provider });
                }
            }
            return Promise.all(
                found.map(async ({ item, provider }, index) => {
                    if (index >= itemResolveCount || !(item instanceof CodeAction) || item.edit !== undefined) {
                        return item;
                    }
                    const resolved = await callWithVscodeToken(CancellationTokenNone, (token) =>
                        provider.resolveCodeAction?.(item, token),
                    );
                    return resolved ?? item;
                }),
            );
        },
    };

    return {
        languages: implementsApi<typeof vscode.languages>()(languagesNs),
        executeProviders,
    };
}
