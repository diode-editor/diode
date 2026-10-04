import { CancellationTokenNone, type ICancellationToken } from "../../../../../base/common/cancellation.ts";
import { Emitter } from "../../../../../base/common/event.ts";
import { Disposable, DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { ITextEdit } from "../../../../../editor/common/core/iTextEdit.ts";
import type { ICodeActionRequest, ICoreCodeAction } from "../../../../../editor/common/languages/iCodeActionSource.ts";
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
import type {
    ICoreSignatureHelp,
    ISignatureHelpRequest,
} from "../../../../../editor/common/languages/iSignatureHelpSource.ts";
import type { IFoldingRegion } from "../../../../../editor/contrib/folding/iFoldingRegion.ts";
import type { ILogger } from "../../../../../platform/log/common/iLogger.ts";
import type { HostRpc, IHostToSubprocess } from "../../../../api/common/extHostProtocol.ts";
import type { RequestParams, RequestResult } from "../../../../api/common/rpcEndpoint.ts";
import {
    type IWireDocumentParams,
    type IWireLanguageProviderRegistration,
    type IWirePositionParams,
    parseWireLanguageProviderRegistration,
    parseWireLanguageProviderUnregistration,
    wireToCoreFoldingRegions,
    wireToCoreRenameLocation,
} from "../../../../api/common/wireTypes.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import { ProviderRequestBatcher } from "../../common/providerRequestBatcher.ts";
import { loggingRequest, type RequestTimeouts, type TimedRequestMethod } from "../requestPolicy.ts";

/** Ответ «автодополнений нет» — общий для всех ранних выходов completion. */
const EMPTY_COMPLETION_RESULT: ICoreCompletionResult = { items: [], isIncomplete: false };

/** Языковой запрос хоста к субпроцессу (со сроком ответа из {@link RequestTimeouts}). */
type LanguageRequestMethod = Exclude<TimedRequestMethod, "workspace.willSaveTextDocument">;

/** Ответ языкового запроса — форма из карты протокола. */
type LanguageResult<K extends LanguageRequestMethod> = RequestResult<IHostToSubprocess, K>;

/** Необязательное в {@link LanguageFeaturesCustomer.request}. */
interface ILanguageRequestOptions<K extends LanguageRequestMethod> {
    /** Ответ без спавна (субпроцесс остановлен), если он не `empty` (rename объясняет отказ). */
    readonly noHost?: LanguageResult<K>;
    /** Ответ по несинхронизированному документу, если он не `empty`. */
    readonly notSynced?: LanguageResult<K>;
    /** Срок ответа вместо табличного (inline completions берут его из запроса). */
    readonly timeoutMs?: number | undefined;
    /** Отмена «сверху» (inline completions). */
    readonly token?: ICancellationToken | undefined;
}

/**
 * Языковые провайдеры расширений (мост под `ILanguageFeaturesService`):
 * субпроцесс объявляет каждого с handle и селектором, ядро само решает, кого
 * спрашивать. Реестр провайдеров живёт один спавн: провайдеры умирают вместе
 * с субпроцессом, и адаптер снимает их прокси из реестра ядра.
 */
export class LanguageFeaturesCustomer extends Disposable implements IExtensionHostCustomer {
    /** Провайдеры текущего спавна по handle; пусто — спавна нет или он ничего не объявил. */
    private readonly providers = new Map<number, IWireLanguageProviderRegistration>();
    private readonly onProvidersChangedEmitter = this.register(new Emitter<void>());

    /** Состав провайдеров изменился: регистрация, снятие или смерть субпроцесса. */
    public readonly onProvidersChanged = this.onProvidersChangedEmitter.event;
    /** Канал текущего спавна; `null` — спавна нет. */
    private rpc: HostRpc | null = null;
    /** Вызовы inline-прокси с одним запросом — одним RPC (см. `provideInlineCompletions`). */
    private readonly inlineCompletionsBatcher = new ProviderRequestBatcher<
        IInlineCompletionRequest,
        readonly ICoreInlineCompletionItem[]
    >((handles, req, token) => this.requestInlineCompletionsBatch(handles, req, token), []);
    /** Вызовы folding-прокси с одним запросом — одним RPC (см. `provideFoldingRanges`). */
    private readonly foldingBatcher = new ProviderRequestBatcher<IFoldingRequest, readonly IFoldingRegion[]>(
        (handles, req) => this.requestFoldingBatch(handles, req),
        [],
    );
    /** Вызовы completion-прокси с одним запросом — одним RPC (см. `provideCompletionItems`). */
    private readonly completionBatcher = new ProviderRequestBatcher<ICompletionRequest, ICoreCompletionResult>(
        (handles, req) => this.requestCompletionBatch(handles, req),
        EMPTY_COMPLETION_RESULT,
    );

    /**
     * @param isSynced держит ли субпроцесс документ (`DocumentsCustomer`):
     *   запросы текста не везут, и по несинхронизированному отвечать не по чему
     */
    public constructor(
        private readonly timeouts: RequestTimeouts,
        private readonly isSynced: (uri: string) => boolean,
        private readonly logger: ILogger | undefined,
    ) {
        super();
    }

    /**
     * Языковые провайдеры, объявленные субпроцессом (`languages.register`).
     * Потребитель — адаптер, регистрирующий их прокси в реестре ядра.
     */
    public getProviders(): readonly IWireLanguageProviderRegistration[] {
        return [...this.providers.values()];
    }

    /**
     * Запрашивает у completion-провайдера субпроцесса `handle` элементы
     * автодополнения для позиции курсора (`languages.provideCompletionItems`).
     * Пустой результат, если субпроцесса нет, документ субпроцессу не синхронизирован или
     * расширение не ответило за отведённый срок. Зовёт его прокси из
     * реестра ядра (`LanguageFeaturesAdapter`); вызовы прокси с одним запросом
     * уходят одним RPC (`ProviderRequestBatcher`).
     */
    public provideCompletionItems(handle: number, req: ICompletionRequest): Promise<ICoreCompletionResult> {
        return this.completionBatcher.call(handle, req);
    }

    private async requestCompletionBatch(
        handles: readonly number[],
        req: ICompletionRequest,
    ): Promise<readonly ICoreCompletionResult[]> {
        const results = await this.request(
            "languages.provideCompletionItems",
            {
                handles,
                ...positionParams(req),
                // Спред — про чистоту payload'а: `undefined`-ключи всё равно
                // выбрасывает JSON-транспорт RPC.
                // Stryker disable next-line ConditionalExpression: см. выше
                ...(req.triggerKind !== undefined ? { triggerKind: req.triggerKind } : {}),
                // Stryker disable next-line ConditionalExpression: см. выше
                ...(req.triggerCharacter !== undefined ? { triggerCharacter: req.triggerCharacter } : {}),
            },
            [],
        );
        // Ответ выровнен по `handles`; недостающий элемент (пустой ответ,
        // обход пачки прерван отменой) — пусто у своего провайдера.
        return handles.map((_handle, index) => results.at(index) ?? EMPTY_COMPLETION_RESULT);
    }

    /**
     * Догружает detail/documentation/additionalTextEdits пункта автодополнения
     * (`languages.resolveCompletionItem`). У стокового LSP-стека это ЕДИНСТВЕННЫЙ
     * путь к описанию и авто-импорту: `typescript-language-server` присылает их
     * не в списке, а по запросу выбранного пункта. `null` — резолвить нечего или
     * расширение не ответило за отведённый срок. `id` уникален сквозь
     * провайдеров: кэш субпроцесса сам знает, чей это пункт.
     */
    public async resolveCompletionItem(id: string): Promise<ICoreResolvedCompletion | null> {
        return this.request("languages.resolveCompletionItem", { id }, null);
    }

    /**
     * Запрашивает у inline-провайдера субпроцесса `handle` подсказки для позиции
     * каретки (`languages.provideInlineCompletions`). Возвращает `[]`, если
     * субпроцесса нет, документ субпроцессу не синхронизирован или расширение не ответило за
     * отпущенный срок. Зовёт его прокси из
     * реестра ядра (`LanguageFeaturesAdapter`); вызовы с одним запросом уходят
     * одним RPC (`ProviderRequestBatcher`, токен отмены — общий у пачки).
     *
     * Срок берётся из САМОГО запроса (`req.timeoutMs` —
     * `editor.inlineSuggest.requestTimeout`), и только в его отсутствие — из
     * отведённый срок хоста. Асимметрия с остальным семейством
     * таймаутов осознанная: остальные фиксируются при создании хоста, а этот
     * человек правит в settings.json и ждёт эффекта без перезапуска.
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
        // Отмена «сверху» и истёкший срок доходят до провайдера одинаково —
        // транспорт отменяет запрос (иначе зависший LLM-вызов считал бы в
        // пустоту до конца жизни субпроцесса).
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
        // Недостающий элемент ответа — пусто у своего провайдера.
        return handles.map((_handle, index) => results.at(index) ?? []);
    }

    /**
     * Отдаёт области сворачивания folding-провайдера субпроцесса `handle` для
     * документа (`languages.provideFoldingRanges`). Пустой массив, если
     * субпроцесса нет, документ субпроцессу не синхронизирован или расширение не ответило за
     * отведённый срок — ядро в этом случае остаётся на indentation-фолдах.
     * Зовёт его прокси из реестра ядра (`LanguageFeaturesAdapter`); вызовы с
     * одним запросом уходят одним RPC (`ProviderRequestBatcher`).
     */
    public provideFoldingRanges(handle: number, req: IFoldingRequest): Promise<readonly IFoldingRegion[]> {
        return this.foldingBatcher.call(handle, req);
    }

    private async requestFoldingBatch(
        handles: readonly number[],
        req: IFoldingRequest,
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
        );
        // Недостающий элемент ответа (обход пачки прерван отменой) — пусто у своего провайдера.
        return handles.map((_handle, index) => wireToCoreFoldingRegions(results.at(index) ?? []));
    }

    /**
     * Запрашивает у definition-провайдера субпроцесса `handle` цели для позиции
     * курсора (`languages.provideDefinition`). Возвращает `[]`, если субпроцесса
     * нет, документ субпроцессу не синхронизирован или расширение не ответило за
     * отведённый срок. Зовёт его прокси из реестра ядра
     * (`LanguageFeaturesAdapter`).
     */
    public async provideDefinition(
        handle: number,
        req: IDefinitionRequest,
    ): Promise<readonly ICoreDefinitionLocation[]> {
        return this.request(
            "languages.provideDefinition",
            {
                handle,
                ...positionParams(req),
            },
            [],
        );
    }

    /**
     * Запрашивает у hover-провайдера субпроцесса `handle` hover для позиции
     * курсора (`languages.provideHover`). Возвращает `undefined`, если
     * субпроцесса нет, документ субпроцессу не синхронизирован или расширение не ответило за
     * отведённый срок. Зовёт его прокси, который `LanguageFeaturesAdapter`
     * держит в реестре ядра.
     */
    public async provideHover(handle: number, req: IHoverRequest): Promise<ICoreHover | undefined> {
        const hover = await this.request(
            "languages.provideHover",
            {
                handle,
                ...positionParams(req),
            },
            null,
        );
        return hover ?? undefined;
    }

    /**
     * Запрашивает у references-провайдера субпроцесса `handle` ссылки на символ
     * под курсором (`languages.provideReferences`). Возвращает `[]`, если
     * субпроцесса нет, документ субпроцессу не синхронизирован или расширение не ответило за
     * отведённый срок. Зовёт его прокси из реестра ядра
     * (`LanguageFeaturesAdapter`).
     */
    public async provideReferences(handle: number, req: IReferenceRequest): Promise<readonly ICoreReference[]> {
        return this.request(
            "languages.provideReferences",
            {
                handle,
                ...positionParams(req),
                includeDeclaration: req.includeDeclaration,
            },
            [],
        );
    }

    /**
     * Запрашивает у провайдера подсказки параметров `handle` подсказку для
     * позиции каретки (`languages.provideSignatureHelp`). `null`, если
     * субпроцесса нет, документ субпроцессу не синхронизирован или расширение не ответило за
     * отведённый срок. Зовёт его прокси из реестра ядра
     * (`LanguageFeaturesAdapter`).
     */
    public async provideSignatureHelp(handle: number, req: ISignatureHelpRequest): Promise<ICoreSignatureHelp | null> {
        return this.request(
            "languages.provideSignatureHelp",
            {
                handle,
                ...positionParams(req),
                triggerKind: req.triggerKind,
                // Оба спреда — про чистоту payload'а: `undefined`-ключи всё равно
                // выбрасывает JSON-транспорт RPC, поэтому за границей канала
                // разницы не видно (потому и Stryker disable).
                // Stryker disable next-line ConditionalExpression: см. выше
                ...(req.triggerCharacter === undefined ? {} : { triggerCharacter: req.triggerCharacter }),
                isRetrigger: req.isRetrigger,
                // Stryker disable next-line ConditionalExpression: см. выше
                ...(req.activeSignatureHelp === undefined ? {} : { activeSignatureHelp: req.activeSignatureHelp }),
            },
            null,
        );
    }

    /**
     * Запрашивает у провайдера форматирования `handle` правки документа (без
     * `req.range` — документный провайдер) или диапазона (с ним — range-провайдер)
     * — `languages.provideFormattingEdits`. Пустой массив — менять нечего,
     * субпроцесса нет, документ субпроцессу не синхронизирован или таймаут отведённый срок
     * (молчаливый no-op). «Нет форматтера» решает ядро по реестру. Зовёт его
     * прокси из реестра ядра (`LanguageFeaturesAdapter`).
     */
    public async provideFormattingEdits(handle: number, req: IFormattingRequest): Promise<readonly ITextEdit[]> {
        return this.request(
            "languages.provideFormattingEdits",
            {
                handle,
                uri: req.uri,
                languageId: req.languageId,
                version: req.versionId,
                tabSize: req.tabSize,
                insertSpaces: req.insertSpaces,
                // Спред — про чистоту payload'а: `undefined`-ключи всё равно
                // выбрасывает JSON-транспорт RPC, поэтому за границей канала
                // разницы не видно.
                // Stryker disable next-line ConditionalExpression: см. выше
                ...(req.range === undefined ? {} : { range: req.range }),
            },
            [],
        );
    }

    /**
     * Запрашивает у code-action-провайдера `handle` действия для диапазона
     * (`languages.provideCodeActions`). Пустой массив — действий не нашлось,
     * субпроцесса нет, документ субпроцессу не синхронизирован или таймаут. Зовёт его прокси из
     * реестра ядра (`LanguageFeaturesAdapter`).
     */
    public async provideCodeActions(handle: number, req: ICodeActionRequest): Promise<readonly ICoreCodeAction[]> {
        return this.request(
            "languages.provideCodeActions",
            {
                handle,
                uri: req.uri,
                languageId: req.languageId,
                version: req.versionId,
                range: req.range,
                // Спред — про чистоту payload'а: `undefined`-ключи всё равно
                // выбрасывает JSON-транспорт RPC.
                // Stryker disable next-line ConditionalExpression: см. выше
                ...(req.only === undefined ? {} : { only: req.only }),
            },
            [],
        );
    }

    /**
     * Просит субпроцесс применить закэшированное действие
     * (`languages.applyCodeAction`): ленивый resolve + правки через
     * `workspace.applyEdit` + команда действия — всё на его стороне. `false` —
     * субпроцесса нет, действие протухло, правки не легли или таймаут
     * отведённый срок. `id` уникален сквозь провайдеров: кэш
     * субпроцесса сам знает, чьё это действие.
     */
    public async applyCodeAction(id: string): Promise<boolean> {
        return this.request("languages.applyCodeAction", { id }, false);
    }

    /**
     * Спрашивает у rename-провайдера `handle` текущее имя символа в позиции
     * каретки (`languages.prepareRename`). `null` — субпроцесса нет, документ
     * не синхронизирован, провайдеру сказать нечего или он не ответил за
     * отведённый срок; ядро в этом случае спрашивает следующего
     * провайдера, а в конце добирает слово под кареткой само.
     */
    public async prepareRename(handle: number, req: IRenameRequest): Promise<ICoreRenameLocation | null> {
        const prepared = await this.request("languages.prepareRename", { handle, ...positionParams(req) }, null);
        return prepared === null ? null : wireToCoreRenameLocation(prepared);
    }

    /**
     * Просит rename-провайдера `handle` переименовать символ под кареткой
     * (`languages.provideRenameEdits`): вызов провайдера и правки существующим
     * `workspace.applyEdit` — всё на стороне субпроцесса. Отказ С СООБЩЕНИЕМ,
     * если субпроцесса нет, документ субпроцессу не синхронизирован или расширение не
     * ответило за отведённый срок: человек ввёл имя и обязан узнать, что
     * ничего не произошло.
     */
    public async provideRenameEdits(handle: number, req: IRenameRequest, newName: string): Promise<ICoreRenameResult> {
        // В отличие от форматирования, молчаливый no-op здесь неприемлем:
        // и неответ, и несинхронизированный документ — отказ с сообщением.
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

    /**
     * Языковой запрос субпроцессу — общий путь всех `provide*`. Ответ —
     * форма из карты протокола: её гарантирует сериализатор субпроцесса, и
     * хост ответ своей второй половины не перепроверяет. `empty` — ответ,
     * когда спрашивать некого (спавна нет, документ субпроцессу не
     * синхронизирован — текста запросы не везут, отвечать не по чему) или
     * расширение не ответило: истёк срок или отказ RPC (его пишет в лог
     * `loggingRequest`). UI никогда не ждёт вечно. Rename различает причины
     * отказа сообщением (`noHost`/`notSynced` в `options`).
     */
    private async request<K extends LanguageRequestMethod>(
        method: K,
        params: RequestParams<IHostToSubprocess, K>,
        empty: LanguageResult<K>,
        options: ILanguageRequestOptions<K> = {},
    ): Promise<LanguageResult<K>> {
        const rpc = this.rpc;
        // Спавн ушёл (остановлен или умер): спрашивать некого.
        if (rpc === null) return options.noHost ?? empty;
        // Запросы по документу (все, кроме resolve/apply по id из кэша
        // субпроцесса): документ, которого субпроцесс не держит, — без RPC.
        const { uri } = params as Partial<IWireDocumentParams>;
        if (uri !== undefined && !this.isSynced(uri)) return options.notSynced ?? empty;
        const { timeoutMs = this.timeouts[method], token } = options;
        try {
            return await loggingRequest(rpc, this.logger)(method, params, {
                timeoutMs,
                ...(token === undefined ? {} : { token }),
            });
        } catch {
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
            rpc.handleNotification("languages.unregister", (params) => {
                const unregistration = parseWireLanguageProviderUnregistration(params);
                // Stryker disable next-line ConditionalExpression: без проверки null падает на `.handle` до события — RpcEndpoint глотает исключение нотификации, наблюдаемо то же «проигнорировано»
                if (unregistration === null || !this.providers.delete(unregistration.handle)) return;
                this.onProvidersChangedEmitter.fire();
            }),
        );
        // Провайдеры умерли вместе с субпроцессом: адаптер снимет их прокси из
        // реестра ядра, и запросы к мёртвым handle не уйдут.
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

/**
 * Документ и позиция каретки в wire-форме — общая часть параметров всех
 * запросов с позицией (completion, inline, definition, hover, references,
 * signature help, обе rename-ручки).
 */
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
