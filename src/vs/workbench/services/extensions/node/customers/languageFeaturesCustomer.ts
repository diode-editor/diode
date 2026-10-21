import { CancellationTokenNone, type ICancellationToken } from "../../../../../base/common/cancellation.ts";
import { Emitter } from "../../../../../base/common/event.ts";
import { Disposable, DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { IRange } from "../../../../../editor/common/core/iRange.ts";
import type { ITextEdit } from "../../../../../editor/common/core/iTextEdit.ts";
import type {
    IApplyCodeActionOptions,
    ICodeActionRequest,
    ICoreCodeAction,
} from "../../../../../editor/common/languages/iCodeActionSource.ts";
import type {
    ICompletionRequest,
    ICoreCompletionResult,
    ICoreResolvedCompletion,
} from "../../../../../editor/common/languages/iCompletionSource.ts";
import type {
    ICoreDefinitionLocation,
    IDefinitionRequest,
} from "../../../../../editor/common/languages/iDefinitionSource.ts";
import type { IFoldingRequest } from "../../../../../editor/common/languages/iFoldingSource.ts";
import type { IFormattingRequest } from "../../../../../editor/common/languages/iFormattingSource.ts";
import type { ICoreHover, IHoverRequest } from "../../../../../editor/common/languages/iHoverSource.ts";
import type {
    ICoreInlineCompletionItem,
    IInlineCompletionRequest,
} from "../../../../../editor/common/languages/iInlineCompletionSource.ts";
import type { ICoreReference, IReferenceRequest } from "../../../../../editor/common/languages/iReferenceSource.ts";
import type {
    ICoreRenameLocation,
    ICoreRenameResult,
    IRenameRequest,
} from "../../../../../editor/common/languages/iRenameSource.ts";
import type { ISelectionRangeRequest } from "../../../../../editor/common/languages/iSelectionRangeSource.ts";
import {
    type IRangeSemanticTokensRequest,
    type ISemanticTokens,
    type ISemanticTokensEdits,
    type ISemanticTokensRequest,
    isSemanticTokensEdits,
} from "../../../../../editor/common/languages/iSemanticTokensSource.ts";
import type {
    ICoreSignatureHelp,
    ISignatureHelpRequest,
} from "../../../../../editor/common/languages/iSignatureHelpSource.ts";
import type { IFoldingRegion } from "../../../../../editor/contrib/folding/iFoldingRegion.ts";
import type { ILogger } from "../../../../../platform/log/common/iLogger.ts";
import type { HostRpc, IHostToSubprocess } from "../../../../api/common/extHostProtocol.ts";
import type { RequestParams, RequestResult } from "../../../../api/common/rpcEndpoint.ts";
import type {
    IWireDocumentParams,
    IWireLanguageProviderRegistration,
    IWirePositionParams,
} from "../../../../api/common/wireTypes.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import { ProviderRequestBatcher } from "../../common/providerRequestBatcher.ts";
import {
    parseWireLanguageProviderRegistration,
    parseWireLanguageProviderUnregistration,
    parseWireProviderHandle,
    wireToCoreFoldingRegions,
    wireToCoreRenameLocation,
    wireToCoreSemanticTokens,
} from "../hostWireParsers.ts";
import { loggingRequest, type RequestTimeouts, type TimedRequestMethod } from "../requestPolicy.ts";

const EMPTY_COMPLETION_RESULT: ICoreCompletionResult = { items: [], isIncomplete: false };

type LanguageRequestMethod =
    | Exclude<TimedRequestMethod, "workspace.willSaveTextDocument">
    | "languages.provideCompletionItems"
    | "languages.provideDocumentSemanticTokens"
    | "languages.provideDocumentRangeSemanticTokens";

type LanguageResult<K extends LanguageRequestMethod> = RequestResult<IHostToSubprocess, K>;

interface ILanguageRequestOptions<K extends LanguageRequestMethod> {
    /** Ответ без спавна, если он не `empty` (rename объясняет отказ). */
    readonly noHost?: LanguageResult<K>;
    readonly notSynced?: LanguageResult<K>;
    readonly timeoutMs?: number | undefined;
    readonly token?: ICancellationToken | undefined;
    /**
     * Отказ RPC — исключением, а не `empty`: семантические токены по сбою
     * оставляют прежнюю раскраску, а по пустому ответу стирают.
     */
    readonly rethrow?: boolean;
}

/** Реестр провайдеров живёт один спавн: провайдеры умирают вместе с субпроцессом. */
export class LanguageFeaturesCustomer extends Disposable implements IExtensionHostCustomer {
    private readonly providers = new Map<number, IWireLanguageProviderRegistration>();
    private readonly onProvidersChangedEmitter = this.register(new Emitter<void>());

    public readonly onProvidersChanged = this.onProvidersChangedEmitter.event;
    private readonly onDidChangeSemanticTokensEmitter = this.register(new Emitter<number>());
    public readonly onDidChangeSemanticTokens = this.onDidChangeSemanticTokensEmitter.event;
    private rpc: HostRpc | null = null;
    private readonly inlineCompletionsBatcher = new ProviderRequestBatcher<
        IInlineCompletionRequest,
        readonly ICoreInlineCompletionItem[]
    >((handles, req, token) => this.requestInlineCompletionsBatch(handles, req, token), []);
    private readonly foldingBatcher = new ProviderRequestBatcher<IFoldingRequest, readonly IFoldingRegion[]>(
        (handles, req, token) => this.requestFoldingBatch(handles, req, token),
        [],
    );
    private readonly completionBatcher = new ProviderRequestBatcher<ICompletionRequest, ICoreCompletionResult>(
        (handles, req, token) => this.requestCompletionBatch(handles, req, token),
        EMPTY_COMPLETION_RESULT,
    );

    /** @param isSynced запросы текста не везут: по несинхронизированному документу отвечать не по чему */
    public constructor(
        private readonly timeouts: RequestTimeouts,
        private readonly isSynced: (uri: string) => boolean,
        private readonly logger: ILogger | undefined,
    ) {
        super();
    }

    public getProviders(): readonly IWireLanguageProviderRegistration[] {
        return [...this.providers.values()];
    }

    /** Срока ответа нет — ждём, пока вызывающий не отменит `token` (см. `DEFAULT_REQUEST_TIMEOUTS`). */
    public provideCompletionItems(
        handle: number,
        req: ICompletionRequest,
        token?: ICancellationToken,
    ): Promise<ICoreCompletionResult> {
        return this.completionBatcher.call(handle, req, token);
    }

    private async requestCompletionBatch(
        handles: readonly number[],
        req: ICompletionRequest,
        token: ICancellationToken | undefined,
    ): Promise<readonly ICoreCompletionResult[]> {
        const results = await this.request(
            "languages.provideCompletionItems",
            {
                handles,
                ...positionParams(req),
                // Stryker disable next-line ConditionalExpression: спред — про чистоту payload'а, `undefined`-ключи всё равно выбрасывает JSON-транспорт RPC
                ...(req.triggerKind !== undefined ? { triggerKind: req.triggerKind } : {}),
                // Stryker disable next-line ConditionalExpression: то же
                ...(req.triggerCharacter !== undefined ? { triggerCharacter: req.triggerCharacter } : {}),
            },
            [],
            { token },
        );
        // Недостающий элемент ответа (обход пачки прерван отменой) — пусто у своего провайдера.
        return handles.map((_handle, index) => results.at(index) ?? EMPTY_COMPLETION_RESULT);
    }

    /**
     * У стокового LSP-стека это ЕДИНСТВЕННЫЙ путь к описанию и авто-импорту:
     * `typescript-language-server` присылает их только по запросу выбранного пункта.
     * `id` уникален сквозь провайдеров.
     */
    public async resolveCompletionItem(id: string): Promise<ICoreResolvedCompletion | null> {
        return this.request("languages.resolveCompletionItem", { id }, null);
    }

    /**
     * Срок — из САМОГО запроса (`editor.inlineSuggest.requestTimeout`), а не из
     * таймаутов хоста: их фиксируют при создании хоста, а этот человек правит в
     * settings.json и ждёт эффекта без перезапуска.
     */
    public provideInlineCompletions(
        handle: number,
        req: IInlineCompletionRequest,
        token: ICancellationToken = CancellationTokenNone,
    ): Promise<readonly ICoreInlineCompletionItem[]> {
        return this.inlineCompletionsBatcher.call(handle, req, token);
    }

    private async requestInlineCompletionsBatch(
        handles: readonly number[],
        req: IInlineCompletionRequest,
        token: ICancellationToken | undefined,
    ): Promise<readonly (readonly ICoreInlineCompletionItem[])[]> {
        // Истёкший срок транспорт тоже доносит до провайдера отменой: иначе
        // зависший LLM-вызов считал бы в пустоту до конца жизни субпроцесса.
        const results = await this.request(
            "languages.provideInlineCompletions",
            {
                handles,
                ...positionParams(req),
                triggerKind: req.triggerKind,
            },
            [],
            { timeoutMs: req.timeoutMs, token },
        );
        return handles.map((_handle, index) => results.at(index) ?? []);
    }

    public provideFoldingRanges(
        handle: number,
        req: IFoldingRequest,
        token?: ICancellationToken,
    ): Promise<readonly IFoldingRegion[]> {
        return this.foldingBatcher.call(handle, req, token);
    }

    private async requestFoldingBatch(
        handles: readonly number[],
        req: IFoldingRequest,
        token: ICancellationToken | undefined,
    ): Promise<readonly (readonly IFoldingRegion[])[]> {
        const results = await this.request(
            "languages.provideFoldingRanges",
            {
                handles,
                uri: req.uri,
                languageId: req.languageId,
                version: req.versionId,
            },
            [],
            { token },
        );
        return handles.map((_handle, index) => wireToCoreFoldingRegions(results.at(index) ?? []));
    }

    public async provideDefinition(
        handle: number,
        req: IDefinitionRequest,
        token?: ICancellationToken,
    ): Promise<readonly ICoreDefinitionLocation[]> {
        return this.request(
            "languages.provideDefinition",
            {
                handle,
                ...positionParams(req),
            },
            [],
            { token },
        );
    }

    public async provideHover(
        handle: number,
        req: IHoverRequest,
        token?: ICancellationToken,
    ): Promise<ICoreHover | undefined> {
        const hover = await this.request(
            "languages.provideHover",
            {
                handle,
                ...positionParams(req),
            },
            null,
            { token },
        );
        return hover ?? undefined;
    }

    public async provideReferences(
        handle: number,
        req: IReferenceRequest,
        token?: ICancellationToken,
    ): Promise<readonly ICoreReference[]> {
        return this.request(
            "languages.provideReferences",
            {
                handle,
                ...positionParams(req),
                includeDeclaration: req.includeDeclaration,
            },
            [],
            { token },
        );
    }

    public async provideSignatureHelp(
        handle: number,
        req: ISignatureHelpRequest,
        token?: ICancellationToken,
    ): Promise<ICoreSignatureHelp | null> {
        return this.request(
            "languages.provideSignatureHelp",
            {
                handle,
                ...positionParams(req),
                triggerKind: req.triggerKind,
                // Спреды — про чистоту payload'а: `undefined`-ключи всё равно выбрасывает JSON-транспорт RPC, потому и Stryker disable.
                // Stryker disable next-line ConditionalExpression: см. выше
                ...(req.triggerCharacter === undefined ? {} : { triggerCharacter: req.triggerCharacter }),
                isRetrigger: req.isRetrigger,
                // Stryker disable next-line ConditionalExpression: см. выше
                ...(req.activeSignatureHelp === undefined ? {} : { activeSignatureHelp: req.activeSignatureHelp }),
            },
            null,
            { token },
        );
    }

    /** Без `req.range` — документный провайдер, с ним — range-провайдер. */
    public async provideFormattingEdits(
        handle: number,
        req: IFormattingRequest,
        token?: ICancellationToken,
    ): Promise<readonly ITextEdit[]> {
        return this.request(
            "languages.provideFormattingEdits",
            {
                handle,
                uri: req.uri,
                languageId: req.languageId,
                version: req.versionId,
                tabSize: req.tabSize,
                insertSpaces: req.insertSpaces,
                // Stryker disable next-line ConditionalExpression: спред — про чистоту payload'а, `undefined`-ключи всё равно выбрасывает JSON-транспорт RPC
                ...(req.range === undefined ? {} : { range: req.range }),
            },
            [],
            { token },
        );
    }

    public async provideCodeActions(
        handle: number,
        req: ICodeActionRequest,
        token?: ICancellationToken,
    ): Promise<readonly ICoreCodeAction[]> {
        return this.request(
            "languages.provideCodeActions",
            {
                handle,
                uri: req.uri,
                languageId: req.languageId,
                version: req.versionId,
                range: req.range,
                // Stryker disable next-line ConditionalExpression: спред — про чистоту payload'а, `undefined`-ключи всё равно выбрасывает JSON-транспорт RPC
                ...(req.only === undefined ? {} : { only: req.only }),
            },
            [],
            { token },
        );
    }

    /**
     * Resolve, правки и команда действия — всё на стороне субпроцесса. `onSave` —
     * действие применяет конвейер сохранения: его правки не сохраняются по
     * `files.refactoring.autoSave`.
     */
    public async applyCodeAction(id: string, options?: IApplyCodeActionOptions): Promise<boolean> {
        return this.request(
            "languages.applyCodeAction",
            { id, ...(options?.onSave === true ? { onSave: true } : {}) },
            false,
        );
    }

    /** `null` — ядро спрашивает следующего провайдера, а в конце добирает слово под кареткой само. */
    public async prepareRename(handle: number, req: IRenameRequest): Promise<ICoreRenameLocation | null> {
        const prepared = await this.request("languages.prepareRename", { handle, ...positionParams(req) }, null);
        return prepared === null ? null : wireToCoreRenameLocation(prepared);
    }

    /**
     * В отличие от форматирования, любой отказ — С СООБЩЕНИЕМ: человек ввёл имя
     * и обязан узнать, что ничего не произошло.
     */
    public async provideRenameEdits(handle: number, req: IRenameRequest, newName: string): Promise<ICoreRenameResult> {
        return this.request(
            "languages.provideRenameEdits",
            { handle, ...positionParams(req), newName },
            { applied: false, error: "Rename timed out" },
            {
                noHost: { applied: false, error: "Rename failed" },
                notSynced: { applied: false, error: "The document is not available to language extensions" },
            },
        );
    }

    public async provideSelectionRanges(
        handle: number,
        req: ISelectionRangeRequest,
        token?: ICancellationToken,
    ): Promise<readonly (readonly IRange[])[]> {
        return this.request(
            "languages.provideSelectionRanges",
            { handle, uri: req.uri, languageId: req.languageId, version: req.versionId, positions: req.positions },
            [],
            { token },
        );
    }

    /**
     * `resultId` ответа — его id в субпроцессе строкой (upstream
     * `MainThreadDocumentSemanticTokensProvider`). Срока нет, как в upstream:
     * ненужный запрос отменяет токен.
     */
    public async provideDocumentSemanticTokens(
        handle: number,
        req: ISemanticTokensRequest,
        previousResultId: number,
        token?: ICancellationToken,
    ): Promise<ISemanticTokens | ISemanticTokensEdits | null> {
        const result = await this.request(
            "languages.provideDocumentSemanticTokens",
            { handle, uri: req.uri, languageId: req.languageId, version: req.versionId, previousResultId },
            null,
            { token, rethrow: true },
        );
        return wireToCoreSemanticTokens(result);
    }

    public async provideDocumentRangeSemanticTokens(
        handle: number,
        req: IRangeSemanticTokensRequest,
        token?: ICancellationToken,
    ): Promise<ISemanticTokens | null> {
        const result = wireToCoreSemanticTokens(
            await this.request(
                "languages.provideDocumentRangeSemanticTokens",
                { handle, uri: req.uri, languageId: req.languageId, version: req.versionId, range: req.range },
                null,
                { token, rethrow: true },
            ),
        );
        if (result !== null && isSemanticTokensEdits(result)) throw new Error("Unexpected");
        return result;
    }

    public releaseDocumentSemanticTokens(handle: number, resultId: number): void {
        this.rpc?.notify("languages.releaseDocumentSemanticTokens", { handle, resultId });
    }

    /**
     * Ответ — форма из карты протокола: её гарантирует сериализатор субпроцесса,
     * хост его не перепроверяет. `empty` — спрашивать некого, истёк срок или отказ RPC.
     */
    private async request<K extends LanguageRequestMethod>(
        method: K,
        params: RequestParams<IHostToSubprocess, K>,
        empty: LanguageResult<K>,
        options: ILanguageRequestOptions<K> = {},
    ): Promise<LanguageResult<K>> {
        const rpc = this.rpc;
        if (rpc === null) return options.noHost ?? empty;
        // Без `uri` — resolve/apply по id из кэша субпроцесса.
        const { uri } = params as Partial<IWireDocumentParams>;
        if (uri !== undefined && !this.isSynced(uri)) return options.notSynced ?? empty;
        // Метод без строки в таблице сроков (автодополнение) ждёт без срока.
        const timeouts: Partial<Record<LanguageRequestMethod, number>> = this.timeouts;
        const { timeoutMs = timeouts[method], token } = options;
        try {
            return await loggingRequest(rpc, this.logger)(method, params, {
                timeoutMs,
                ...(token === undefined ? {} : { token }),
            });
        } catch (err) {
            if (options.rethrow === true) throw err;
            return empty;
        }
    }

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        this.rpc = rpc;
        const store = new DisposableStore();
        store.add(
            rpc.handleNotification("languages.register", (params) => {
                const registration = parseWireLanguageProviderRegistration(params);
                // Stryker disable next-line ConditionalExpression: без проверки null падает на `.handle` до события — RpcEndpoint глотает исключение нотификации, наблюдаемо то же «проигнорировано»
                if (registration === null) return;
                this.providers.set(registration.handle, registration);
                this.onProvidersChangedEmitter.fire();
            }),
        );
        store.add(
            rpc.handleNotification("languages.didChangeSemanticTokens", (params) => {
                const parsed = parseWireProviderHandle(params);
                // Stryker disable next-line ConditionalExpression: без проверки null падает на `.handle` до события — RpcEndpoint глотает исключение нотификации, наблюдаемо то же «проигнорировано»
                if (parsed !== null && this.providers.has(parsed.handle)) {
                    this.onDidChangeSemanticTokensEmitter.fire(parsed.handle);
                }
            }),
        );
        store.add(
            rpc.handleNotification("languages.unregister", (params) => {
                const unregistration = parseWireLanguageProviderUnregistration(params);
                // Stryker disable next-line ConditionalExpression: без проверки null падает на `.handle` до события — RpcEndpoint глотает исключение нотификации, наблюдаемо то же «проигнорировано»
                if (unregistration === null || !this.providers.delete(unregistration.handle)) return;
                this.onProvidersChangedEmitter.fire();
            }),
        );
        store.add({
            dispose: () => {
                this.rpc = null;
                if (this.providers.size === 0) return;
                this.providers.clear();
                this.onProvidersChangedEmitter.fire();
            },
        });
        return store;
    }
}

function positionParams(
    req: Pick<ICompletionRequest, "uri" | "languageId" | "versionId" | "line" | "character">,
): IWirePositionParams {
    return {
        uri: req.uri,
        languageId: req.languageId,
        version: req.versionId,
        line: req.line,
        character: req.character,
    };
}
