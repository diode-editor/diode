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
import type { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import {
    type IWireLanguageProviderRegistration,
    parseWireLanguageProviderRegistration,
    parseWireLanguageProviderUnregistration,
    requestApplyCodeAction,
    requestCodeActions,
    requestCompletionItems,
    requestDefinition,
    requestFoldingRanges,
    requestFormattingEdits,
    requestHover,
    requestInlineCompletions,
    requestPrepareRename,
    requestReferences,
    requestRename,
    requestResolveCompletionItem,
    requestSignatureHelp,
} from "../../../../api/common/wireTypes.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import { ProviderRequestBatcher } from "../../common/providerRequestBatcher.ts";
import type { IExtensionHostOptions } from "../extensionHost.ts";

import { MAX_WILL_SAVE_TEXT_BYTES } from "./documentsCustomer.ts";

/** Ответ «автодополнений нет» — общий для всех ранних выходов completion. */
const EMPTY_COMPLETION_RESULT: ICoreCompletionResult = { items: [], isIncomplete: false };

/** Таймауты запросов к провайдерам (см. одноимённые опции хоста). */
export type LanguageFeaturesTimeouts = Pick<
    Required<IExtensionHostOptions>,
    | "completionTimeoutMs"
    | "inlineCompletionTimeoutMs"
    | "foldingTimeoutMs"
    | "definitionTimeoutMs"
    | "hoverTimeoutMs"
    | "referencesTimeoutMs"
    | "signatureHelpTimeoutMs"
    | "formattingTimeoutMs"
    | "codeActionsTimeoutMs"
    | "applyCodeActionTimeoutMs"
    | "prepareRenameTimeoutMs"
    | "renameTimeoutMs"
>;

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
    private rpc: RpcEndpoint | null = null;
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

    public constructor(
        private readonly timeouts: LanguageFeaturesTimeouts,
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
     * Пустой результат, если субпроцесса нет, документ слишком большой или
     * расширение не ответило за `completionTimeoutMs`. Зовёт его прокси из
     * реестра ядра (`LanguageFeaturesAdapter`); вызовы прокси с одним запросом
     * уходят одним RPC (`ProviderRequestBatcher` — полный текст документа не
     * множится на число провайдеров).
     */
    public provideCompletionItems(handle: number, req: ICompletionRequest): Promise<ICoreCompletionResult> {
        return this.completionBatcher.call(handle, req);
    }

    private async requestCompletionBatch(
        handles: readonly number[],
        req: ICompletionRequest,
    ): Promise<readonly ICoreCompletionResult[]> {
        const rpc = this.rpc;
        // Stryker disable next-line ConditionalExpression,ArrayDeclaration: `rpc` обнуляется только на уходе спавна, тем же dispose, что снимает регистрации, а с ними и прокси в реестре — пара «канала нет, а прокси зовут» недостижима; проверка стоит защитой от обращения к мёртвому каналу
        if (rpc === null) return [];
        if (req.text.length > MAX_WILL_SAVE_TEXT_BYTES) {
            this.logger?.warn("skipping completion: document too large", {
                uri: req.uri,
                length: req.text.length,
            });
            return [];
        }
        return requestCompletionItems(
            (method, params) => rpc.request(method, params),
            {
                handles,
                uri: req.uri,
                languageId: req.languageId,
                text: req.text,
                line: req.line,
                character: req.character,
                // Спред — про чистоту payload'а: `undefined`-ключи всё равно
                // выбрасывает JSON-транспорт RPC.
                // Stryker disable next-line ConditionalExpression: см. выше
                ...(req.triggerKind !== undefined ? { triggerKind: req.triggerKind } : {}),
                // Stryker disable next-line ConditionalExpression: см. выше
                ...(req.triggerCharacter !== undefined ? { triggerCharacter: req.triggerCharacter } : {}),
            },
            this.timeouts.completionTimeoutMs,
        );
    }

    /**
     * Догружает detail/documentation/additionalTextEdits пункта автодополнения
     * (`languages.resolveCompletionItem`). У стокового LSP-стека это ЕДИНСТВЕННЫЙ
     * путь к описанию и авто-импорту: `typescript-language-server` присылает их
     * не в списке, а по запросу выбранного пункта. `null` — резолвить нечего или
     * расширение не ответило за `completionTimeoutMs`. `id` уникален сквозь
     * провайдеров: кэш субпроцесса сам знает, чей это пункт.
     */
    public async resolveCompletionItem(id: string): Promise<ICoreResolvedCompletion | null> {
        const rpc = this.rpc;
        // Stryker disable next-line ConditionalExpression: см. requestCompletionBatch — без канала прокси уже сняты из реестра
        if (rpc === null) return null;
        return requestResolveCompletionItem(
            (method, params) => rpc.request(method, params),
            id,
            this.timeouts.completionTimeoutMs,
        );
    }

    /**
     * Запрашивает у inline-провайдера субпроцесса `handle` подсказки для позиции
     * каретки (`languages.provideInlineCompletions`). Возвращает `[]`, если
     * субпроцесса нет, документ слишком большой или расширение не ответило за
     * отпущенный срок. Зовёт его прокси из
     * реестра ядра (`LanguageFeaturesAdapter`); вызовы с одним запросом уходят
     * одним RPC (`ProviderRequestBatcher`, токен отмены — общий у пачки).
     *
     * Срок берётся из САМОГО запроса (`req.timeoutMs` —
     * `editor.inlineSuggest.requestTimeout`), и только в его отсутствие — из
     * `inlineCompletionTimeoutMs` хоста. Асимметрия с остальным семейством
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
        const rpc = this.rpc;
        // Stryker disable next-line ConditionalExpression: `rpc` обнуляется только на уходе спавна, тем же dispose, что снимает регистрации, а с ними и прокси в реестре — пара «канала нет, а прокси зовут» недостижима; проверка стоит защитой от обращения к мёртвому каналу
        if (rpc === null) return [];
        if (req.text.length > MAX_WILL_SAVE_TEXT_BYTES) {
            this.logger?.warn("skipping inline completion: document too large", {
                uri: req.uri,
                length: req.text.length,
            });
            return [];
        }
        return requestInlineCompletions(
            (method, params, cancellation) => rpc.request(method, params, cancellation),
            {
                handles,
                uri: req.uri,
                languageId: req.languageId,
                text: req.text,
                line: req.line,
                character: req.character,
                triggerKind: req.triggerKind,
            },
            req.timeoutMs ?? this.timeouts.inlineCompletionTimeoutMs,
            token,
        );
    }

    /**
     * Отдаёт области сворачивания folding-провайдера субпроцесса `handle` для
     * документа (`languages.provideFoldingRanges`). Пустой массив, если
     * субпроцесса нет, документ слишком большой или расширение не ответило за
     * `foldingTimeoutMs` — ядро в этом случае остаётся на indentation-фолдах.
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
        const rpc = this.rpc;
        // Stryker disable next-line ConditionalExpression: `rpc` обнуляется только на уходе спавна, тем же dispose, что снимает регистрации, а с ними и прокси в реестре — пара «канала нет, а прокси зовут» недостижима; проверка стоит защитой от обращения к мёртвому каналу
        if (rpc === null) return [];
        if (req.text.length > MAX_WILL_SAVE_TEXT_BYTES) {
            this.logger?.warn("skipping folding: document too large", {
                uri: req.uri,
                length: req.text.length,
            });
            return [];
        }
        return requestFoldingRanges(
            (method, params) => rpc.request(method, params),
            {
                handles,
                uri: req.uri,
                languageId: req.languageId,
                text: req.text,
            },
            this.timeouts.foldingTimeoutMs,
        );
    }

    /**
     * Запрашивает у definition-провайдера субпроцесса `handle` цели для позиции
     * курсора (`languages.provideDefinition`). Возвращает `[]`, если субпроцесса
     * нет, документ слишком большой или расширение не ответило за
     * `definitionTimeoutMs`. Зовёт его прокси из реестра ядра
     * (`LanguageFeaturesAdapter`).
     */
    public async provideDefinition(
        handle: number,
        req: IDefinitionRequest,
    ): Promise<readonly ICoreDefinitionLocation[]> {
        const rpc = this.rpc;
        // Stryker disable next-line ConditionalExpression,ArrayDeclaration: `rpc` обнуляется только на уходе спавна, тем же dispose, что снимает регистрации, а с ними и прокси в реестре — пара «канала нет, а прокси зовут» недостижима; проверка стоит защитой от обращения к мёртвому каналу
        if (rpc === null) return [];
        if (req.text.length > MAX_WILL_SAVE_TEXT_BYTES) {
            this.logger?.warn("skipping definition: document too large", {
                uri: req.uri,
                length: req.text.length,
            });
            return [];
        }
        return requestDefinition(
            (method, params) => rpc.request(method, params),
            {
                handle,
                uri: req.uri,
                languageId: req.languageId,
                text: req.text,
                line: req.line,
                character: req.character,
            },
            this.timeouts.definitionTimeoutMs,
        );
    }

    /**
     * Запрашивает у hover-провайдера субпроцесса `handle` hover для позиции
     * курсора (`languages.provideHover`). Возвращает `undefined`, если
     * субпроцесса нет, документ слишком большой или расширение не ответило за
     * `hoverTimeoutMs`. Зовёт его прокси, который `LanguageFeaturesAdapter`
     * держит в реестре ядра.
     */
    public async provideHover(handle: number, req: IHoverRequest): Promise<ICoreHover | undefined> {
        const rpc = this.rpc;
        // Stryker disable next-line ConditionalExpression: `rpc` обнуляется только на уходе спавна, тем же dispose, что снимает регистрации, а с ними и прокси в реестре — пара «канала нет, а прокси зовут» недостижима; проверка стоит защитой от обращения к мёртвому каналу
        if (rpc === null) return undefined;
        if (req.text.length > MAX_WILL_SAVE_TEXT_BYTES) {
            this.logger?.warn("skipping hover: document too large", {
                uri: req.uri,
                length: req.text.length,
            });
            return undefined;
        }
        return requestHover(
            (method, params) => rpc.request(method, params),
            {
                handle,
                uri: req.uri,
                languageId: req.languageId,
                text: req.text,
                line: req.line,
                character: req.character,
            },
            this.timeouts.hoverTimeoutMs,
        );
    }

    /**
     * Запрашивает у references-провайдера субпроцесса `handle` ссылки на символ
     * под курсором (`languages.provideReferences`). Возвращает `[]`, если
     * субпроцесса нет, документ слишком большой или расширение не ответило за
     * `referencesTimeoutMs`. Зовёт его прокси из реестра ядра
     * (`LanguageFeaturesAdapter`).
     */
    public async provideReferences(handle: number, req: IReferenceRequest): Promise<readonly ICoreReference[]> {
        const rpc = this.rpc;
        // Stryker disable next-line ConditionalExpression: `rpc` обнуляется только на уходе спавна, тем же dispose, что снимает регистрации, а с ними и прокси в реестре — пара «канала нет, а прокси зовут» недостижима; проверка стоит защитой от обращения к мёртвому каналу
        if (rpc === null) return [];
        if (req.text.length > MAX_WILL_SAVE_TEXT_BYTES) {
            this.logger?.warn("skipping references: document too large", {
                uri: req.uri,
                length: req.text.length,
            });
            return [];
        }
        return requestReferences(
            (method, params) => rpc.request(method, params),
            {
                handle,
                uri: req.uri,
                languageId: req.languageId,
                text: req.text,
                line: req.line,
                character: req.character,
                includeDeclaration: req.includeDeclaration,
            },
            this.timeouts.referencesTimeoutMs,
        );
    }

    /**
     * Запрашивает у провайдера подсказки параметров `handle` подсказку для
     * позиции каретки (`languages.provideSignatureHelp`). `null`, если
     * субпроцесса нет, документ слишком большой или расширение не ответило за
     * `signatureHelpTimeoutMs`. Зовёт его прокси из реестра ядра
     * (`LanguageFeaturesAdapter`).
     */
    public async provideSignatureHelp(handle: number, req: ISignatureHelpRequest): Promise<ICoreSignatureHelp | null> {
        const rpc = this.rpc;
        // Stryker disable next-line ConditionalExpression: `rpc` обнуляется только на уходе спавна, тем же dispose, что снимает регистрации, а с ними и прокси в реестре — пара «канала нет, а прокси зовут» недостижима; проверка стоит защитой от обращения к мёртвому каналу
        if (rpc === null) return null;
        if (req.text.length > MAX_WILL_SAVE_TEXT_BYTES) {
            this.logger?.warn("skipping signature help: document too large", {
                uri: req.uri,
                length: req.text.length,
            });
            return null;
        }
        return requestSignatureHelp(
            (method, params) => rpc.request(method, params),
            {
                handle,
                uri: req.uri,
                languageId: req.languageId,
                text: req.text,
                line: req.line,
                character: req.character,
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
            this.timeouts.signatureHelpTimeoutMs,
        );
    }

    /**
     * Запрашивает у провайдера форматирования `handle` правки документа (без
     * `req.range` — документный провайдер) или диапазона (с ним — range-провайдер)
     * — `languages.provideFormattingEdits`. Пустой массив — менять нечего,
     * субпроцесса нет, документ слишком большой или таймаут `formattingTimeoutMs`
     * (молчаливый no-op). «Нет форматтера» решает ядро по реестру. Зовёт его
     * прокси из реестра ядра (`LanguageFeaturesAdapter`).
     */
    public async provideFormattingEdits(handle: number, req: IFormattingRequest): Promise<readonly ITextEdit[]> {
        const rpc = this.rpc;
        // Stryker disable next-line ConditionalExpression: `rpc` обнуляется только на уходе спавна, тем же dispose, что снимает регистрации, а с ними и прокси в реестре — пара «канала нет, а прокси зовут» недостижима; проверка стоит защитой от обращения к мёртвому каналу
        if (rpc === null) return [];
        if (req.text.length > MAX_WILL_SAVE_TEXT_BYTES) {
            this.logger?.warn("skipping formatting: document too large", {
                uri: req.uri,
                length: req.text.length,
            });
            return [];
        }
        return requestFormattingEdits(
            (method, params) => rpc.request(method, params),
            {
                handle,
                uri: req.uri,
                languageId: req.languageId,
                text: req.text,
                tabSize: req.tabSize,
                insertSpaces: req.insertSpaces,
                // Спред — про чистоту payload'а: `undefined`-ключи всё равно
                // выбрасывает JSON-транспорт RPC, поэтому за границей канала
                // разницы не видно.
                // Stryker disable next-line ConditionalExpression: см. выше
                ...(req.range === undefined
                    ? {}
                    : {
                          range: {
                              startLine: req.range.start.line,
                              startCharacter: req.range.start.character,
                              endLine: req.range.end.line,
                              endCharacter: req.range.end.character,
                          },
                      }),
            },
            this.timeouts.formattingTimeoutMs,
        );
    }

    /**
     * Запрашивает у code-action-провайдера `handle` действия для диапазона
     * (`languages.provideCodeActions`). Пустой массив — действий не нашлось,
     * субпроцесса нет, документ слишком большой или таймаут. Зовёт его прокси из
     * реестра ядра (`LanguageFeaturesAdapter`).
     */
    public async provideCodeActions(handle: number, req: ICodeActionRequest): Promise<readonly ICoreCodeAction[]> {
        const rpc = this.rpc;
        // Stryker disable next-line ConditionalExpression: `rpc` обнуляется только на уходе спавна, тем же dispose, что снимает регистрации, а с ними и прокси в реестре — пара «канала нет, а прокси зовут» недостижима; проверка стоит защитой от обращения к мёртвому каналу
        if (rpc === null) return [];
        if (req.text.length > MAX_WILL_SAVE_TEXT_BYTES) {
            this.logger?.warn("skipping code actions: document too large", {
                uri: req.uri,
                length: req.text.length,
            });
            return [];
        }
        return requestCodeActions(
            (method, params) => rpc.request(method, params),
            {
                handle,
                uri: req.uri,
                languageId: req.languageId,
                text: req.text,
                range: {
                    startLine: req.range.start.line,
                    startCharacter: req.range.start.character,
                    endLine: req.range.end.line,
                    endCharacter: req.range.end.character,
                },
                // Спред — про чистоту payload'а: `undefined`-ключи всё равно
                // выбрасывает JSON-транспорт RPC.
                // Stryker disable next-line ConditionalExpression: см. выше
                ...(req.only === undefined ? {} : { only: req.only }),
            },
            this.timeouts.codeActionsTimeoutMs,
        );
    }

    /**
     * Просит субпроцесс применить закэшированное действие
     * (`languages.applyCodeAction`): ленивый resolve + правки через
     * `workspace.applyEdit` + команда действия — всё на его стороне. `false` —
     * субпроцесса нет, действие протухло, правки не легли или таймаут
     * `applyCodeActionTimeoutMs`. `id` уникален сквозь провайдеров: кэш
     * субпроцесса сам знает, чьё это действие.
     */
    public async applyCodeAction(id: string): Promise<boolean> {
        const rpc = this.rpc;
        // Stryker disable next-line ConditionalExpression: см. provideCodeActions — без канала прокси уже сняты из реестра
        if (rpc === null) return false;
        return requestApplyCodeAction(
            (method, params) => rpc.request(method, params),
            id,
            this.timeouts.applyCodeActionTimeoutMs,
        );
    }

    /**
     * Спрашивает у rename-провайдера `handle` текущее имя символа в позиции
     * каретки (`languages.prepareRename`). `null` — субпроцесса нет, документ
     * слишком большой, провайдеру сказать нечего или он не ответил за
     * `prepareRenameTimeoutMs`; ядро в этом случае спрашивает следующего
     * провайдера, а в конце добирает слово под кареткой само.
     */
    public async prepareRename(handle: number, req: IRenameRequest): Promise<ICoreRenameLocation | null> {
        const rpc = this.rpc;
        // Stryker disable next-line ConditionalExpression: см. provideCodeActions — без канала прокси уже сняты из реестра
        if (rpc === null) return null;
        if (req.text.length > MAX_WILL_SAVE_TEXT_BYTES) {
            this.logger?.warn("skipping prepare rename: document too large", {
                uri: req.uri,
                length: req.text.length,
            });
            return null;
        }
        return requestPrepareRename(
            (method, params) => rpc.request(method, params),
            { handle, ...renameTarget(req) },
            this.timeouts.prepareRenameTimeoutMs,
        );
    }

    /**
     * Просит rename-провайдера `handle` переименовать символ под кареткой
     * (`languages.provideRenameEdits`): вызов провайдера и правки существующим
     * `workspace.applyEdit` — всё на стороне субпроцесса. Отказ С СООБЩЕНИЕМ,
     * если субпроцесса нет, документ слишком большой или расширение не
     * ответило за `renameTimeoutMs`: человек ввёл имя и обязан узнать, что
     * ничего не произошло.
     */
    public async provideRenameEdits(handle: number, req: IRenameRequest, newName: string): Promise<ICoreRenameResult> {
        const rpc = this.rpc;
        // Stryker disable next-line ConditionalExpression: см. provideCodeActions — без канала прокси уже сняты из реестра
        if (rpc === null) return { applied: false, error: "Rename failed" };
        if (req.text.length > MAX_WILL_SAVE_TEXT_BYTES) {
            this.logger?.warn("skipping rename: document too large", {
                uri: req.uri,
                length: req.text.length,
            });
            return { applied: false, error: "Document too large to rename" };
        }
        return requestRename(
            (method, params) => rpc.request(method, params),
            { handle, ...renameTarget(req), newName },
            this.timeouts.renameTimeoutMs,
        );
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
 * Общая часть параметров обеих rename-ручек: документ и позиция каретки.
 * `prepareRename` и `provideRenameEdits` спрашивают об одном и том же месте,
 * и расходятся только новым именем.
 */
function renameTarget(req: IRenameRequest): {
    uri: string;
    languageId: string;
    text: string;
    line: number;
    character: number;
} {
    return {
        uri: req.uri,
        languageId: req.languageId,
        text: req.text,
        line: req.line,
        character: req.character,
    };
}
