import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { ILogger } from "../../../../../platform/log/common/iLogger.ts";
import type { IDocumentSyncTarget } from "../../../../api/common/iDocumentSyncTarget.ts";
import type { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import { type IWireDocumentSyncSnapshot, requestWillSaveEdits } from "../../../../api/common/wireTypes.ts";
import type { ISaveEdit, ISaveSnapshot } from "../../../textfile/common/iSaveParticipant.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";

/** Порог, выше которого снапшот документа не гоняется через RPC (8 MB). */
export const MAX_WILL_SAVE_TEXT_BYTES = 8 * 1024 * 1024;

export interface IDocumentsCustomerOptions {
    /** Тайм-аут на ответ участника will-save, мс. */
    readonly willSaveTimeoutMs: number;
    /** Снапшоты открытых документов для семени `editor.didOpen` на handshake. */
    readonly openDocumentsProvider: (() => IWireDocumentSyncSnapshot[]) | undefined;
    /** Есть ли у хоста хоть одно расширение: без них didOpen/didClose не шлём. */
    readonly hasExtensions: () => boolean;
    readonly logger: ILogger | undefined;
}

/** Состояние одного спавна: канал, подписки субпроцесса и отложенные didChange. */
interface ISpawnDocuments {
    readonly rpc: RpcEndpoint;
    /** Есть ли в субпроцессе активные подписки на will/did-save (см. `workspace.updateSubscriptions`). */
    willSaveSubscribed: boolean;
    didSaveSubscribed: boolean;
    /** Есть ли в субпроцессе подписки document sync (onDidOpen/onDidChangeTextDocument). */
    documentSyncSubscribed: boolean;
    /**
     * Коалесинг didChange в пределах тика (latest-wins ПО ДОКУМЕНТУ) — правка на
     * каждое нажатие не гоняет RPC-шторм. Map, а не один слот: с per-document
     * sync два документа, изменившиеся в один тик (bulk-правки), потеряли бы
     * одно из сообщений.
     */
    readonly pendingDidChange: Map<string, IWireDocumentSyncSnapshot>;
}

/**
 * Документы для расширений: участники will/did-save и document sync
 * (`workspace.textDocuments`, onDidOpen/Change/Close). Подписки субпроцесса и
 * отложенные didChange живут один спавн; семя открытых документов хост шлёт на
 * своём месте последовательности handshake ({@link pushInitialState}).
 */
export class DocumentsCustomer implements IExtensionHostCustomer, IDocumentSyncTarget {
    private live: ISpawnDocuments | null = null;

    public constructor(private readonly options: IDocumentsCustomerOptions) {}

    /**
     * Семя handshake: наполняем `workspace.textDocuments` открытыми документами
     * ДО первой активации — стоковый vscode-languageclient читает его на start().
     * Мимо гейта подписки — подписчиков в этот момент ещё нет.
     */
    public pushInitialState(): void {
        const live = this.live;
        if (live === null) return;
        const openDocuments = this.options.openDocumentsProvider?.() ?? [];
        for (const snapshot of openDocuments) live.rpc.notify("editor.didOpen", snapshot);
    }

    /**
     * Запрашивает у субпроцесса правки will-save (`onWillSaveTextDocument`).
     * Возвращает `[]`, если субпроцесса нет, никто не подписан, документ слишком
     * большой или расширение не ответило за `willSaveTimeoutMs`.
     */
    public async willSaveTextDocument(snapshot: ISaveSnapshot): Promise<readonly ISaveEdit[]> {
        const live = this.live;
        if (!live?.willSaveSubscribed) return [];
        // Guard: очень большой документ не гоняем через RPC (арх-решение плана).
        if (snapshot.text.length > MAX_WILL_SAVE_TEXT_BYTES) {
            this.options.logger?.warn("skipping will-save participant: document too large", {
                uri: snapshot.uri,
                length: snapshot.text.length,
            });
            return [];
        }
        const rpc = live.rpc;
        return requestWillSaveEdits(
            (method, params) => rpc.request(method, params),
            {
                uri: snapshot.uri,
                languageId: snapshot.languageId,
                version: snapshot.versionId,
                isDirty: snapshot.isDirty,
                text: snapshot.text,
                reason: 1, // TextDocumentSaveReason.Manual
                eol: snapshot.eol,
                encoding: snapshot.encoding,
            },
            this.options.willSaveTimeoutMs,
        );
    }

    /**
     * Уведомляет субпроцесс о состоявшемся сохранении (`onDidSaveTextDocument`).
     * No-op, если субпроцесса нет или никто не подписан.
     */
    public didSaveTextDocument(meta: { uri: string; languageId: string }): void {
        const live = this.live;
        if (!live?.didSaveSubscribed) return;
        live.rpc.notify("workspace.didSaveTextDocument", meta);
    }

    /**
     * Пушит открытие документа в subprocess (`editor.didOpen`) — там пополняется
     * `workspace.textDocuments` и фаерится `onDidOpenTextDocument`, на которое
     * подписан document sync стокового vscode-languageclient. Подпиской НЕ
     * гейтится (в отличие от didChange): `workspace.textDocuments` обязан нести
     * полный текст активного документа ещё ДО активации клиента — стоковый
     * languageclient на `start()` рассылает серверу didOpen для всех документов
     * реестра, и meta-обёртка с пустым текстом отравила бы сервер. No-op без
     * subprocess'а и для слишком больших документов.
     */
    public didOpenTextDocument(snapshot: IWireDocumentSyncSnapshot): void {
        const live = this.live;
        if (live === null || !this.options.hasExtensions()) return;
        if (!this.fitsDocumentSyncLimit(snapshot)) return;
        live.rpc.notify("editor.didOpen", snapshot);
    }

    /**
     * Пушит изменение документа (`editor.didChange` → `onDidChangeTextDocument`).
     * Снапшоты коалесируются в пределах тика (latest-wins): многошаговая правка
     * даёт одну нотификацию с последним текстом, версии остаются монотонными.
     */
    public didChangeTextDocument(snapshot: IWireDocumentSyncSnapshot): void {
        const live = this.live;
        if (!live?.documentSyncSubscribed) return;
        if (!this.fitsDocumentSyncLimit(snapshot)) return;
        const pendingDidChange = live.pendingDidChange;
        // Stryker disable next-line ConditionalExpression: эквивалентный — лишний микротаск найдёт карту уже опустошённой первым и ничего не пошлёт
        const alreadyScheduled = pendingDidChange.size > 0;
        pendingDidChange.set(snapshot.uri, snapshot);
        // Stryker disable next-line ConditionalExpression: эквивалентный — см. выше
        if (alreadyScheduled) return;
        queueMicrotask(() => {
            const pending = [...pendingDidChange.values()];
            pendingDidChange.clear();
            for (const item of pending) {
                live.rpc.notify("editor.didChange", item);
            }
        });
    }

    /**
     * Пушит закрытие документа (`editor.didClose` → `onDidCloseTextDocument` +
     * сброс didOpen-дедупа в субпроцессе). Не гейтится подпиской — симметрично
     * didOpen: bookkeeping открытых документов у реестра всегда честный.
     */
    public didCloseTextDocument(uri: string): void {
        const live = this.live;
        if (live === null || !this.options.hasExtensions()) return;
        live.pendingDidChange.delete(uri);
        live.rpc.notify("editor.didClose", { uri });
    }

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        const live: ISpawnDocuments = {
            rpc,
            willSaveSubscribed: false,
            didSaveSubscribed: false,
            documentSyncSubscribed: false,
            pendingDidChange: new Map(),
        };
        this.live = live;
        const store = new DisposableStore();
        // Субпроцесс сообщает, есть ли подписчики на will/did-save. Без них хост
        // не гоняет RPC на сохранении (save остаётся синхронным).
        store.add(
            rpc.handleNotification("workspace.updateSubscriptions", (params) => {
                const p = params as { willSave?: unknown; didSave?: unknown; documentSync?: unknown };
                live.willSaveSubscribed = p.willSave === true;
                live.didSaveSubscribed = p.didSave === true;
                // didOpen подпиской не гейтится (см. didOpenTextDocument) — реестр
                // документов субпроцесса всегда несёт полный текст активного, и
                // доталкивать его на переходе подписки не нужно.
                live.documentSyncSubscribed = p.documentSync === true;
            }),
        );
        // Отложенные didChange адресованы ушедшему субпроцессу: микротаск,
        // если он ещё в очереди, найдёт пустую карту.
        store.add({
            dispose: () => {
                live.pendingDidChange.clear();
                this.live = null;
            },
        });
        return store;
    }

    /** Защитный лимит на снапшот document sync (8 МБ). */
    private fitsDocumentSyncLimit(snapshot: IWireDocumentSyncSnapshot): boolean {
        if (snapshot.text.length <= MAX_WILL_SAVE_TEXT_BYTES) return true;
        this.options.logger?.warn("skipping document sync: document too large", {
            uri: snapshot.uri,
            length: snapshot.text.length,
        });
        return false;
    }
}
