import type * as vscode from "vscode";

import { describeRejection } from "../../../base/common/describeRejection.ts";
import { isCancellationError } from "../../../base/common/errorSerialization.ts";
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
import {
    rangeFrom,
    readDocumentation,
    serializeCompletionItem,
    serializeDefinitionLocation,
    serializeFoldingRange,
    serializeHoverContents,
    serializeInlineCompletionItem,
    serializeRenamePrepare,
    serializeSignatureHelp,
    serializeTextEdit,
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
    IWireEditorEdit,
    IWireFoldingParams,
    IWireFormattingParams,
    IWireHoverParams,
    IWireInlineCompletionParams,
    IWireLanguageProviderMetadata,
    IWirePrepareRenameParams,
    IWireReferenceParams,
    IWireRenameParams,
    IWireSignatureHelpParams,
    Received,
    WireCodeAction,
    WireFoldingRange,
    WireLanguageFeatureKind,
    WireRenamePrepare,
    WireRenameResult,
} from "./wireTypes.ts";

/** Зарегистрированный провайдер автодополнения. */
export interface ICompletionRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.CompletionItemProvider;
    readonly triggerCharacters: readonly string[];
}

/** Зарегистрированный inline-completion-провайдер (ghost text). */
export interface IInlineCompletionRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.InlineCompletionItemProvider;
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

/** Зарегистрированный rename-провайдер. */
export interface IRenameRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.RenameProvider;
}

/** Зарегистрированный hover-провайдер. */
export interface IHoverRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.HoverProvider;
}

/** Зарегистрированный references-провайдер. */
export interface IReferenceRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.ReferenceProvider;
}

/**
 * Зарегистрированный провайдер подсказки параметров. Триггер- и
 * ретриггер-символы объявляет сервер: клиент передаёт их либо rest-аргументами,
 * либо объектом-метаданными (вторую форму он выбирает, когда сервер прислал
 * `retriggerCharacters`).
 */
export interface ISignatureHelpRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.SignatureHelpProvider;
    readonly triggerCharacters: readonly string[];
    readonly retriggerCharacters: readonly string[];
}

/**
 * Зарегистрированный code-action-провайдер. `providedKinds` — из
 * `CodeActionProviderMetadata.providedCodeActionKinds`: непустой список
 * позволяет НЕ спрашивать провайдера, когда запрошенный `only` заведомо
 * не пересекается с его видами.
 */
export interface ICodeActionRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.CodeActionProvider;
    readonly providedKinds: readonly string[];
}

/** Зарегистрированный провайдер форматирования документа. */
export interface IFormattingRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.DocumentFormattingEditProvider;
}

/** Зарегистрированный провайдер форматирования диапазона. */
export interface IRangeFormattingRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.DocumentRangeFormattingEditProvider;
}

/**
 * Владелец регистрации провайдера — id расширения, зарегистрировавшего его
 * (окружающий владелец {@link IVscodeHostContext.owner} в момент `register*`).
 * `undefined` — регистрация вне оверлея расширения (общий namespace).
 */
interface IRegistrationOwner {
    readonly owner: string | undefined;
}

/** Регистрация провайдера вместе с её владельцем. */
type Owned<T> = T & IRegistrationOwner;

/**
 * Элемент кэша ответов completion — оригинальный объект провайдера, сам
 * провайдер (у него спрашивают resolve) и id расширения-владельца регистрации.
 */
interface ICachedCompletion extends IRegistrationOwner {
    readonly item: vscode.CompletionItem;
    readonly provider: vscode.CompletionItemProvider;
}

/** Сколько последних ответов completion держим ради resolve. */
const COMPLETION_CACHE_DEPTH = 2;

/**
 * Кэшированный элемент ответа code actions: действие (тот же объект, что
 * вернул провайдер, — resolve обязан получить его же) + регистрация,
 * у чьего провайдера спрашивать resolveCodeAction.
 */
interface ICachedCodeAction {
    readonly item: vscode.CodeAction | vscode.Command;
    readonly registration: Owned<ICodeActionRegistration>;
}

/** Пересечение диапазонов, границы включительно (как `vscode.Range.intersection`). */
function rangesIntersect(a: Range, b: Range): boolean {
    const startsBeforeOrAt = (x: Position, y: Position): boolean =>
        x.line < y.line || (x.line === y.line && x.character <= y.character);
    return startsBeforeOrAt(a.start, b.end) && startsBeforeOrAt(b.start, a.end);
}

/**
 * Текст отклонения промиса провайдера для показа человеку. `Error` несёт
 * `message`, но провайдер вправе отклонить промис чем угодно — включая строку
 * и `undefined` (у отказа без причины остаётся родовое сообщение).
 */
function renameRejectReason(error: unknown): string {
    if (typeof error === "string" && error !== "") return error;
    const message = (error as { message?: unknown } | null | undefined)?.message;
    if (typeof message === "string" && message !== "") return message;
    return "Rename failed";
}

/**
 * Третий аргумент `registerSignatureHelpProvider`: либо объект-метаданные
 * (эту форму выбирает стоковый клиент, когда сервер прислал
 * `retriggerCharacters`), либо rest-строки триггер-символов.
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

/** Массив строк из утиного значения; всё лишнее отбрасывается. */
function readStringList(raw: unknown): readonly string[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is string => typeof item === "string");
}

/**
 * Нормализует результат провайдера в элементы + флаг «список неполный».
 * `isIncomplete` — не косметика: на нём стоит решение ядра перезапросить
 * провайдеров при доборе символа вместо локальной фильтрации (у tsserver
 * список почти всегда неполный).
 */
function normalizeResult(result: unknown): { items: readonly vscode.CompletionItem[]; isIncomplete: boolean } {
    if (result === undefined || result === null) return { items: [], isIncomplete: false };
    if (Array.isArray(result)) return { items: result as vscode.CompletionItem[], isIncomplete: false };
    const items = (result as { items?: unknown }).items;
    const isIncomplete = (result as { isIncomplete?: unknown }).isIncomplete === true;
    return { items: Array.isArray(items) ? (items as vscode.CompletionItem[]) : [], isIncomplete };
}

/**
 * Пишет сбой провайдера в stderr субпроцесса (host зеркалит его в лог-канал).
 *
 * Молчаливый `catch` стоит здесь намеренно: сбойный провайдер не должен ломать
 * команду. Но МОЛЧАЛИВЫМ он быть не должен — на этом сгорел день отладки
 * стокового prettier: его `provideDocumentFormattingEdits` падал на
 * отсутствующем `TextDocument.positionAt`, снаружи это выглядело как «форматтер
 * ответил: менять нечего», и ни в одном логе следа не было (#381).
 */
function reportProviderFailure(method: string, err: unknown, owner: string | undefined): void {
    // Отмена — штатный исход отменённого запроса (провайдер честно бросил
    // CancellationError по токену), а не сбой.
    if (isCancellationError(err)) return;
    // id расширения-владельца: без него строка не говорит, ЧЕЙ провайдер упал.
    const tag = owner === undefined ? "" : `[${owner}] `;
    console.error(`[ext-host] ${tag}${method} failed: ${describeRejection(err)}`);
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
/**
 * Зависимости applyCodeAction, живущие в соседних namespace'ах: правки
 * применяются через `workspace.applyEdit` (RPC до хоста внутри), команды
 * действия — через `commands.executeCommand` (локальный реестр + прокси-мост).
 * Ассемблер передаёт настоящие функции; дефолт — честные отказы для тестов,
 * которым applyCodeAction не нужен.
 */
export interface ICodeActionDeps {
    readonly applyEdit: (edit: vscode.WorkspaceEdit) => Thenable<boolean>;
    readonly executeCommand: (command: string, ...args: unknown[]) => Thenable<unknown>;
}

const NULL_CODE_ACTION_DEPS: ICodeActionDeps = {
    // Stryker disable next-line ArrowFunction: `undefined` и `Promise<false>` для applyCodeAction неотличимы — оба читаются как «не применилось»
    applyEdit: () => Promise.resolve(false),
    // Текст отказа виден: applyCodeAction пишет сбой команды в stderr.
    executeCommand: () => Promise.reject(new Error("commands bridge is not wired")),
};

export function createLanguagesNamespace(
    ctx: IVscodeHostContext,
    codeActionDeps: ICodeActionDeps = NULL_CODE_ACTION_DEPS,
): {
    languages: typeof vscode.languages;
} {
    const { rpc, documentSync } = ctx;
    // Провайдеры фич, переехавших в реестр ядра: по handle, который ядро
    // присылает в запросе (upstream ExtHostLanguageFeatures._adapter).
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
    let nextProviderHandle = 0;

    /**
     * Регистрирует провайдера под новым handle и объявляет его реестру ядра
     * (`languages.register`): скоринг по селектору делает ядро, а субпроцесс
     * зовут уже с выбранным handle. Dispose снимает провайдера и в ядре
     * (`languages.unregister`).
     */
    function registerByHandle<T>(
        providers: Map<number, Owned<T>>,
        kind: WireLanguageFeatureKind,
        selector: vscode.DocumentSelector,
        registration: T,
        metadata: IWireLanguageProviderMetadata = {},
        onUnregister?: (handle: number) => void,
    ): vscode.Disposable {
        const handle = nextProviderHandle++;
        // Владелец запоминается сейчас: оверлей выставляет его только на время
        // синхронного `register*`, а сбой провайдера случится много позже.
        providers.set(handle, { ...registration, owner: ctx.owner.current });
        rpc.notify("languages.register", { handle, kind, selector: toWireLanguageFilters(selector), ...metadata });
        return new DisposableImpl(() => {
            if (!providers.delete(handle)) return;
            rpc.notify("languages.unregister", { handle });
            onUnregister?.(handle);
        });
    }

    // Кэш ответов completion для resolve. Держим последние COMPLETION_CACHE_DEPTH
    // ответов: пользователь резолвит пункт из текущего списка, а гонка «ответ
    // пришёл, попап уже перезапросил» стоит одного лишнего ведра.
    const completionCache = new Map<number, readonly ICachedCompletion[]>();
    let nextCacheId = 1;

    function rememberCompletions(cacheId: number, items: readonly ICachedCompletion[]): void {
        completionCache.set(cacheId, items);
        // Вытесняем самые старые вёдра (Map хранит порядок вставки).
        const excess = completionCache.size - COMPLETION_CACHE_DEPTH;
        for (const key of [...completionCache.keys()].slice(0, excess)) completionCache.delete(key);
    }

    /** Достаёт элемент по id вида `"<cacheId>.<index>"`; `null` — ведро вытеснено. */
    function findCachedCompletion(id: string): ICachedCompletion | null {
        const [rawCacheId, rawIndex] = id.split(".");
        const bucket = completionCache.get(Number(rawCacheId));
        return bucket?.[Number(rawIndex)] ?? null;
    }

    // Кэш ответов code actions для apply/resolve — та же схема вёдер, что у
    // completion: применять нужно ТОТ ЖЕ объект действия, который вернул
    // провайдер (у клиента это ProtocolCodeAction с приватным `data`).
    //
    // Глубина — на ПРОВАЙДЕРА, а не общая (у эталона кэш свой у каждого
    // адаптера, `ExtHostLanguageFeatures.CodeActionAdapter._cache`): ядро
    // спрашивает каждого провайдера отдельным запросом, и одно меню — это
    // ведро на провайдера. Общая глубина 2 при трёх провайдерах вытесняла
    // ведро самого быстрого ещё до выбора пункта — «Fix with Supermaven»
    // рядом с tsserver и ещё одним провайдером отвечал «Code action failed».
    const codeActionCache = new Map<
        number,
        { readonly handle: number; readonly items: readonly ICachedCodeAction[] }
    >();

    function rememberCodeActions(cacheId: number, handle: number, items: readonly ICachedCodeAction[]): void {
        codeActionCache.set(cacheId, { handle, items });
        // Вытесняем самые старые вёдра ЭТОГО провайдера (Map хранит порядок вставки).
        const own = [...codeActionCache].filter(([, bucket]) => bucket.handle === handle);
        const excess = own.length - COMPLETION_CACHE_DEPTH;
        for (const [key] of own.slice(0, excess)) codeActionCache.delete(key);
    }

    /** Снятый провайдер уносит свои вёдра (у эталона кэш умирает вместе с адаптером). */
    function forgetCodeActions(handle: number): void {
        for (const [key, bucket] of codeActionCache) {
            if (bucket.handle === handle) codeActionCache.delete(key);
        }
    }

    /** Достаёт действие по id вида `"<cacheId>.<index>"`; `null` — ведро вытеснено. */
    function findCachedCodeAction(id: string): ICachedCodeAction | null {
        const [rawCacheId, rawIndex] = id.split(".");
        const bucket = codeActionCache.get(Number(rawCacheId))?.items;
        return bucket?.[Number(rawIndex)] ?? null;
    }

    // Хранилища ВСЕХ DiagnosticCollection расширений: из них собирается
    // контекст code actions (те же объекты Diagnostic, что публиковал клиент).
    // Снятая коллекция (`dispose`) отсюда уходит — её диагностики больше не контекст.
    const diagnosticStores = new Set<Map<string, readonly vscode.Diagnostic[]>>();
    // Сколько коллекций уже заведено под каждой базой ключа MarkerService
    // (см. createDiagnosticCollection): ключи не переиспользуются.
    const diagnosticOwnerCounts = new Map<string, number>();

    /** Диагностики ресурса, пересекающиеся с диапазоном (по всем коллекциям). */
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
            // Провайдер мог сняться, пока запрос летел: отвечаем «целей нет».
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
                // Сбойный провайдер = «целей нет»: `result` остаётся неприсвоенным,
                // и сериализация ниже его отбрасывает.
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
        // Провайдер мог сняться, пока запрос летел: отвечаем «hover'а нет».
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
            // Сбойный провайдер = «hover'а нет»: `result` остаётся неприсвоенным,
            // и его отсеивает общая проверка ниже.
        }
        if (result == null) return null;
        const contents = serializeHoverContents((result as { contents?: unknown }).contents);
        if (contents.length === 0) return null;
        const range = rangeFrom((result as { range?: unknown }).range);
        return { contents, ...(range === null ? {} : { range }) };
    });

    rpc.handleRequest(
        "languages.provideSignatureHelp",
        async (params, cancellation): Promise<ICoreSignatureHelp | null> => {
            // Всё, кроме `uri`, читаем как необязательное: по RPC приезжает что
            // прислали, и дефолты ниже — не украшение, а обработка недоехавшего поля.
            const p: Received<IWireSignatureHelpParams> = params;
            // Провайдер мог сняться, пока запрос летел: отвечаем «подсказки нет».
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
                // Сбойный провайдер = «подсказки нет»: `result` остаётся
                // неприсвоенным, и его отсеивает сериализация ниже.
            }
            return serializeSignatureHelp(result);
        },
    );

    rpc.handleRequest("languages.provideReferences", async (params, cancellation): Promise<ICoreReference[]> => {
        const p: Received<IWireReferenceParams> = params;
        // Провайдер мог сняться, пока запрос летел: отвечаем «ссылок нет».
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
            // Сбойный провайдер = «ссылок нет»: `result` остаётся неприсвоенным,
            // и его отсеивает общая проверка ниже.
        }
        // References — всегда массив (`ProviderResult<Location[]>`), в
        // отличие от definition с его одиночной формой.
        if (!Array.isArray(result)) return [];
        const references: ICoreReference[] = [];
        for (const item of result) {
            const wire = serializeDefinitionLocation(item);
            if (wire !== null) references.push(wire);
        }
        return references;
    });

    /**
     * Документ (из зеркала) и позиция запроса rename; `null` — документ не
     * открыт или запрос устарел. Обе ручки (`prepareRename` /
     * `provideRenameEdits`) принимают одну и ту же форму параметров.
     */
    function syncRenameTarget(
        p: Received<IWirePrepareRenameParams>,
    ): { doc: ExtHostTextDocument; position: Position } | null {
        const doc = documentSync.resolve(p.uri, p.version, p.languageId);
        if (doc === null) return null;
        return { doc, position: new Position(p.line ?? 0, p.character ?? 0) };
    }

    rpc.handleRequest("languages.prepareRename", async (params, cancellation): Promise<WireRenamePrepare | null> => {
        const p: Received<IWirePrepareRenameParams> = params;
        // Провайдер мог сняться, пока запрос летел: «сказать нечего».
        const reg = renameProviders.get(p.handle ?? -1);
        if (reg === undefined) return null;
        const prepare = reg.provider.prepareRename?.bind(reg.provider);
        // Провайдер без `prepareRename` — не отказ: эталон в этом случае
        // переименовывает слово под кареткой, а что считать словом — решает
        // ядро (у него есть текст и своя классификация символов).
        if (prepare === undefined) return null;
        const target = syncRenameTarget(p);
        if (target === null) return null;
        const { doc, position } = target;
        let result: unknown;
        try {
            result = await callWithVscodeToken(cancellation, (token) => prepare(doc, position, token));
        } catch (error) {
            // «Здесь переименовывать нельзя» эталон выражает именно отказом
            // промиса — это ответ провайдера, а не сбой, и причина едет человеку.
            return { rejectReason: renameRejectReason(error) };
        }
        if (result == null) return null;
        return serializeRenamePrepare(result, doc);
    });

    rpc.handleRequest("languages.provideRenameEdits", async (params, cancellation): Promise<WireRenameResult> => {
        const p: Received<IWireRenameParams> = params;
        // Провайдер мог сняться, пока запрос летел: «правок нет».
        const reg = renameProviders.get(p.handle ?? -1);
        if (reg === undefined) return { applied: false };
        const { newName } = p;
        if (typeof newName !== "string" || newName === "") {
            return { applied: false, error: "Rename requires a new name" };
        }
        const target = syncRenameTarget(p);
        // Документ ушёл дальше запроса (или закрыт) — правки по нему легли бы
        // не туда; человек узнаёт, что ничего не произошло.
        if (target === null) return { applied: false, error: "The document changed during rename" };
        const { doc, position } = target;
        let edit: unknown;
        try {
            edit = await callWithVscodeToken(cancellation, (token) =>
                reg.provider.provideRenameEdits(doc, position, newName, token),
            );
        } catch (error) {
            // Отклонённый промис — штатный канал «имя невалидно» эталона («If
            // the given name is not valid, the provider must return a rejected
            // promise»): сообщение провайдера едет человеку.
            return { applied: false, error: renameRejectReason(error) };
        }
        // Не-правки от провайдера («нет результата») — ядро спросит следующего.
        if (!(edit instanceof WorkspaceEdit)) return { applied: false };
        const ok = await codeActionDeps.applyEdit(edit);
        return ok ? { applied: true } : { applied: false, error: "Rename failed to apply edits" };
    });

    // Форматирование (#196): один RPC на оба вида — с `range` зовётся
    // range-провайдер (Format Selection, а также «синтетический» формат
    // документа range-провайдером на полный диапазон), без — документный.
    // Провайдера выбрало ядро (по score — `editor/contrib/format`); снятый или
    // чужой handle — пустой ответ, как и сбой провайдера (no-op).
    rpc.handleRequest("languages.provideFormattingEdits", async (params, cancellation): Promise<IWireEditorEdit[]> => {
        const p: Received<IWireFormattingParams> = params;
        const handle = p.handle ?? -1;
        const range = p.range;
        // Вызов провайдера, выбранного ядром; `undefined` — handle снят или чужого вида.
        let format:
            | ((
                  doc: vscode.TextDocument,
                  options: vscode.FormattingOptions,
                  token: vscode.CancellationToken,
              ) => vscode.ProviderResult<vscode.TextEdit[]>)
            | undefined;
        // Владелец выбранной регистрации — для строки сбоя в stderr.
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
            // Сбойный провайдер — пустой ответ (no-op), не «нет форматтера»:
            // `result` остаётся неприсвоенным, его отсеет проверка ниже. В
            // stderr — иначе сбой неотличим от «менять нечего».
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

    // Code actions (#196): контекст-диагностики собираются ЗДЕСЬ из локальных
    // DiagnosticCollection (те же объекты, что публиковал клиент, — с приватным
    // `data`, по которому сервер матчит фиксы), а не едут с хоста lossy-копией.
    // Провайдера выбрало ядро (по селектору и `providedCodeActionKinds`);
    // снятый или чужой handle — пустой список.
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
            // Сбойный провайдер = «действий нет»: `result` остаётся
            // неприсвоенным, и его отсеивает проверка ниже.
        }
        if (!Array.isArray(result)) return [];
        // Элементы — `unknown`: что отдал провайдер расширения, тем и является;
        // до проверки заголовка это ещё не `CodeAction | Command`.
        for (const item of result as unknown[]) {
            // У примитива `title` читается как undefined — отсеется той же проверкой.
            if (typeof (item as { title?: unknown } | null | undefined)?.title !== "string") continue;
            // `only` фильтрует по виду; голые команды вида не имеют и при
            // запрошенном `only` отбрасываются (как в VS Code).
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
                // `disabled` — публичное поле `{ reason }`: причина едет строкой,
                // ядро показывает действие неактивным и не применяет (эталон —
                // `typeConvert.CodeAction`, `disabled: action.disabled?.reason`).
                ...(typeof disabledReason === "string" ? { disabled: disabledReason } : {}),
            });
        }
        rememberCodeActions(cacheId, handle, cached);
        return wire;
    });

    // Применение закэшированного действия: ленивый resolve (правки многих
    // серверов приезжают только по codeAction/resolve), затем правки через
    // `workspace.applyEdit` (существующий RPC до хоста) и команда действия.
    rpc.handleRequest("languages.applyCodeAction", async (params, cancellation): Promise<boolean> => {
        const id: unknown = params.id;
        if (typeof id !== "string") return false;
        const found = findCachedCodeAction(id);
        if (found === null) return false;
        const owner = found.registration.owner;

        /** Исполняет команду действия; `false` — команда упала (сбой — в stderr). */
        async function runActionCommand(command: vscode.Command): Promise<boolean> {
            try {
                await codeActionDeps.executeCommand(command.command, ...((command.arguments ?? []) as unknown[]));
                return true;
            } catch (err) {
                reportProviderFailure(`applyCodeAction command "${command.command}"`, err, owner);
                return false;
            }
        }

        // Голая команда (`vscode.Command`): исполняем и всё.
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
            const ok = await codeActionDeps.applyEdit(action.edit);
            // Правки не легли — команду не запускаем: VS Code применяет edit
            // ПЕРЕД командой, и продолжать после отказа значило бы исполнить
            // действие наполовину.
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
            // Провайдеров — в присланном ядром порядке; ответ выровнен по `handles`.
            // Снятый, пока запрос летел, или чужой handle — пустой результат.
            for (const handle of Array.isArray(p.handles) ? p.handles : []) {
                // Отменённый запрос дальше не обходим: ответа уже никто не ждёт,
                // а следующий провайдер посчитал бы его зря.
                if (cancellation.isCancellationRequested) break;
                // Handle чужого типа Map.get и так не найдёт — отдельная проверка не нужна.
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
                    // Сбойный провайдер = пустой результат: `result` остаётся
                    // неприсвоенным, и нормализация ниже даёт пустой список.
                }
                const normalized = normalizeResult(result);
                for (const item of normalized.items) {
                    // id выдаём ДО сериализации: resolve обязан получить тот же самый
                    // объект, который вернул провайдер (у languageclient это
                    // ProtocolCompletionItem с приватным `data` для completionItem/resolve).
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

    /**
     * `languages.resolveCompletionItem`: догружает detail/documentation/
     * additionalTextEdits выбранного пункта. Стоковый languageclient объявляет
     * серверу `resolveSupport` именно на эти три свойства — у tsserver в первом
     * ответе их нет вовсе.
     */
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
                return null; // сбойный resolve не должен ронять попап
            }
            const item = (resolved ?? entry.item) as vscode.CompletionItem;
            const detail = (item as { detail?: unknown }).detail;
            const documentation = readDocumentation(item);
            const rawEdits = (item as { additionalTextEdits?: unknown }).additionalTextEdits;
            const additionalEdits: IWireEditorEdit[] = [];
            if (Array.isArray(rawEdits)) {
                for (const edit of rawEdits) {
                    const wire = serializeTextEdit(edit);
                    if (wire !== null) additionalEdits.push(wire);
                }
            }
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
            // Один токен на всю пачку: ядро гасит устаревший запрос (или его
            // срок истёк), и провайдер — в первую очередь платный LLM — узнаёт
            // об этом. Расширение на vscode-languageclient превратит сработавший
            // токен в `$/cancelRequest` языковому серверу.
            const cancel = toVscodeCancellationToken(cancellation);
            // selectedCompletionInfo не поддержан: пока открыт suggest-попап, ядро
            // ghost text не запрашивает вовсе (люфт v1 — docs/TODO/InlineCompletions.md).
            const context: vscode.InlineCompletionContext = {
                triggerKind: p.triggerKind ?? InlineCompletionTriggerKind.Automatic,
                selectedCompletionInfo: undefined,
            };

            // Провайдеров — в присланном ядром порядке; ответ выровнен по
            // `handles`. Снятый, пока запрос летел, или чужой handle — пусто.
            const results: ICoreInlineCompletionItem[][] = [];
            try {
                for (const handle of Array.isArray(p.handles) ? p.handles : []) {
                    const items: ICoreInlineCompletionItem[] = [];
                    results.push(items);
                    // Отмена останавливает и обход пачки: спрашивать следующего
                    // провайдера про снапшот, который уже никому не нужен, — та
                    // же лишняя работа, от которой мы уходим.
                    if (cancel.token.isCancellationRequested) continue;
                    // Handle чужого типа Map.get и так не найдёт — отдельная проверка не нужна.
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
                        // Сбойный провайдер не роняет остальные: `result` остаётся
                        // неприсвоенным, и его отсеивает общая проверка ниже — своего
                        // `continue` тут нет намеренно, иначе ветка неотличима от неё
                        // (тот же приём, что у hover).
                    }
                    if (result == null) continue;
                    // `InlineCompletionItem[] | InlineCompletionList` — нормализуем к массиву.
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

        // Провайдеров — в присланном ядром порядке; ответ выровнен по `handles`.
        // Снятый, пока запрос летел, или чужой handle — пустой список.
        const results: WireFoldingRange[][] = [];
        for (const handle of Array.isArray(p.handles) ? p.handles : []) {
            // Отменённый запрос дальше не обходим — как у completion.
            if (cancellation.isCancellationRequested) break;
            // Handle чужого типа Map.get и так не найдёт — отдельная проверка не нужна.
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
                // Сбойный провайдер = пустой список: `result` остаётся
                // неприсвоенным, и его отсеивает проверка ниже.
            }
            if (!Array.isArray(result)) continue;
            for (const range of result as vscode.FoldingRange[]) {
                const wire = serializeFoldingRange(range);
                if (wire !== null) ranges.push(wire);
            }
        }
        return results;
    });

    // No-op регистрация провайдера — валидный Disposable; фича не работает,
    // но стоковый клиент (vscode-languageclient заводит провайдеры под
    // capabilities сервера) не падает. Шаги закрытия каждого — docs/TODO/LSP.md.
    const registerNoopProvider = (): vscode.Disposable => new DisposableImpl(() => undefined);

    /**
     * Коллекция диагностик, форвардящая маркеры хосту нотификацией
     * `diagnostics.publish` — хост пишет их в `MarkerService`, откуда их
     * подхватывают squiggle-декорации редактора и панель Problems. Ресурс
     * нормализуется в `uri.toString()` (ключ MarkerService).
     */
    const createDiagnosticCollection = (name?: string): vscode.DiagnosticCollection => {
        // Ключ MarkerService уникален на коллекцию: одноимённые (и безымянные)
        // коллекции — того же или разных расширений — иначе затирали бы маркеры
        // друг друга. База — id расширения-владельца и имя; повтор базы
        // получает счётчик (как `_idPool` у ExtHostDiagnostics эталона).
        const extensionId = ctx.owner.current;
        const base = `ext:${extensionId === undefined ? "" : `${extensionId}:`}${name ?? "diagnostics"}`;
        const taken = diagnosticOwnerCounts.get(base) ?? 0;
        diagnosticOwnerCounts.set(base, taken + 1);
        const owner = taken === 0 ? base : `${base}#${String(taken)}`;
        // Оригинальные Diagnostic'и расширения (контракт get/forEach); wire-форма
        // считается на публикации.
        const store = new Map<string, readonly vscode.Diagnostic[]>();
        // Регистрируем хранилище для сборки контекста code actions: провайдер
        // должен видеть ТЕ ЖЕ объекты диагностик, что публиковал клиент.
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
        };

        // Параметры-ресурсы — `unknown`, а не `Uri`: JS-расширение вправе
        // прислать строку, и `resourceOf` её разбирает.
        const collection: vscode.DiagnosticCollection = {
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
        createDiagnosticCollection,
        // Наивный language status item: держатель полей с честным dispose, в UI
        // ничего не проецируется (в статус-баре места под язык-статус нет).
        // Ruff держит в нём состояние сервера и обновляет text/severity/busy.
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
        // Настоящий match: vscode-languageclient фильтрует ИМ документы для
        // синхронизации с сервером (textSynchronization.js) — наивный «всегда 10»
        // скармливал ts-серверу markdown и meta-обёртки, сервер ронял хендлеры.
        // Score тот же, что у реестра ядра: `*` — 5, точное совпадение — 10.
        match: (selector: vscode.DocumentSelector, document: vscode.TextDocument): number =>
            scoreDocumentSelector(selector, document),

        registerCompletionItemProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.CompletionItemProvider,
            ...triggerCharacters: string[]
        ): vscode.Disposable => {
            // Символы, после которых ядро само открывает попап («.» у tsserver):
            // сервер объявляет их в completionProvider, стоковый клиент — здесь.
            // Едут метаданными регистрации: ядро берёт их только у провайдеров,
            // подошедших документу.
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
            // Символы, после которых ядро само открывает подсказку («(», «,»,
            // «<» у tsserver), и ретриггеры («)») едут метаданными регистрации:
            // ядро берёт их только у провайдеров, подошедших документу.
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
            // Виды едут метаданными: провайдера, чьи виды не пересекаются с
            // запрошенным `only`, ядро не спрашивает вовсе.
            return registerByHandle(
                codeActionProviders,
                "codeActions",
                selector,
                registration,
                { providedCodeActionKinds: providedKinds },
                forgetCodeActions,
            );
        },

        // ── No-op провайдеры (поверхность, которую трогает vscode-languageclient
        // под capabilities сервера). Закрытие каждого — по образцу definition:
        // seam + RPC + UI-потребитель; см. таблицу стабов в docs/TODO/LSP.md. ──
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
        registerSelectionRangeProvider: registerNoopProvider,
        registerDocumentSemanticTokensProvider: registerNoopProvider,
        registerDocumentRangeSemanticTokensProvider: registerNoopProvider,
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
    };

    return {
        languages: implementsApi<typeof vscode.languages>()(languagesNs),
    };
}
