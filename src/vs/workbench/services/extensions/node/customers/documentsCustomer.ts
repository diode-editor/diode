import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { ILogger } from "../../../../../platform/log/common/iLogger.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import type { IDocumentSyncTarget } from "../../../../api/common/iDocumentSyncTarget.ts";
import type { IWireDocumentChangedEvent, IWireDocumentSyncSnapshot } from "../../../../api/common/wireTypes.ts";
import type { ISaveEdit, ISaveSnapshot } from "../../../textfile/common/iSaveParticipant.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import { requestWillSaveEdits } from "../hostRequests.ts";
import { loggingRequest } from "../requestPolicy.ts";

/**
 * В символах, как `_MODEL_SYNC_LIMIT` эталона. Решается на открытии (и замене содержимого
 * целиком): документ сверх порога для расширений не существует.
 */
export const MAX_SYNCED_DOCUMENT_CHARS = 50 * 1024 * 1024;

export interface IDocumentsCustomerOptions {
    /** Мс. */
    readonly willSaveTimeoutMs: number;
    readonly openDocumentsProvider: (() => IWireDocumentSyncSnapshot[]) | undefined;
    readonly maxSyncedDocumentChars: number;
    readonly logger: ILogger | undefined;
}

interface ISpawnDocuments {
    readonly rpc: HostRpc;
    willSaveSubscribed: boolean;
    didSaveSubscribed: boolean;
    /** Правка по документу вне набора не шлётся: применённая к чужому тексту, она испортила бы зеркало. */
    readonly synced: Set<string>;
}

/**
 * Правки уходят синхронно и без коалесинга: порядок сообщений в канале заменяет версию в запросе
 * (как `$acceptModelChanged` эталона).
 */
export class DocumentsCustomer implements IExtensionHostCustomer, IDocumentSyncTarget {
    private live: ISpawnDocuments | null = null;

    public constructor(private readonly options: IDocumentsCustomerOptions) {}

    /** ДО первой активации: стоковый vscode-languageclient читает `workspace.textDocuments` на start(). */
    public pushInitialState(): void {
        const live = this.live;
        if (live === null) return;
        const openDocuments = this.options.openDocumentsProvider?.() ?? [];
        for (const snapshot of openDocuments) this.didOpenTextDocument(snapshot);
    }

    /** Запросы по несинхронизированному — пустой ответ без RPC: текста запросы не везут. */
    public isSynced(uri: string): boolean {
        return this.live?.synced.has(uri) === true;
    }

    /** Текст документа запрос не везёт — участник читает зеркало. */
    public async willSaveTextDocument(snapshot: ISaveSnapshot): Promise<readonly ISaveEdit[]> {
        const live = this.live;
        if (!live?.willSaveSubscribed || !live.synced.has(snapshot.uri)) return [];
        const rpc = live.rpc;
        return requestWillSaveEdits(
            loggingRequest(rpc, this.options.logger),
            {
                uri: snapshot.uri,
                languageId: snapshot.languageId,
                version: snapshot.versionId,
                isDirty: snapshot.isDirty,
                reason: 1, // TextDocumentSaveReason.Manual
                eol: snapshot.eol,
                encoding: snapshot.encoding,
            },
            this.options.willSaveTimeoutMs,
        );
    }

    public didSaveTextDocument(meta: { uri: string; languageId: string }): void {
        const live = this.live;
        if (!live?.didSaveSubscribed) return;
        live.rpc.notify("workspace.didSaveTextDocument", meta);
    }

    public didOpenTextDocument(snapshot: IWireDocumentSyncSnapshot): void {
        const live = this.live;
        if (live === null || !this.fitsDocumentSyncLimit(snapshot)) return;
        live.rpc.notify("editor.didOpen", snapshot);
        live.synced.add(snapshot.uri);
    }

    /** Синхронизированный, переросший лимит, закрывается — зеркало разошлось бы навсегда; ставший подъёмным — открывается. */
    public didChangeTextDocument(snapshot: IWireDocumentSyncSnapshot): void {
        const live = this.live;
        if (live === null) return;
        const synced = live.synced.has(snapshot.uri);
        if (this.fitsDocumentSyncLimit(snapshot)) {
            live.rpc.notify(synced ? "editor.didChange" : "editor.didOpen", snapshot);
            live.synced.add(snapshot.uri);
        } else if (synced) {
            live.synced.delete(snapshot.uri);
            live.rpc.notify("editor.didClose", { uri: snapshot.uri });
        }
    }

    /** Без коалесинга: запрос провайдера, ушедший следом, едет по тому же каналу после правок. */
    public didChangeTextDocumentContent(event: IWireDocumentChangedEvent): void {
        const live = this.live;
        if (!live?.synced.has(event.uri)) return;
        live.rpc.notify("editor.didChange", event);
    }

    public didCloseTextDocument(uri: string): void {
        const live = this.live;
        if (!live?.synced.delete(uri)) return;
        live.rpc.notify("editor.didClose", { uri });
    }

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        const live: ISpawnDocuments = {
            rpc,
            willSaveSubscribed: false,
            didSaveSubscribed: false,
            synced: new Set(),
        };
        this.live = live;
        const store = new DisposableStore();
        // Без подписчиков хост не гоняет RPC на сохранении (save остаётся синхронным).
        store.add(
            rpc.handleNotification("workspace.updateSubscriptions", (params) => {
                // Флаг `documentSync` не нужен: правки идут всем синхронизированным документам —
                // пропуск любой испортил бы зеркало.
                const p: { willSave?: unknown; didSave?: unknown } = params;
                live.willSaveSubscribed = p.willSave === true;
                live.didSaveSubscribed = p.didSave === true;
            }),
        );
        store.add({
            dispose: () => {
                this.live = null;
            },
        });
        return store;
    }

    private fitsDocumentSyncLimit(snapshot: IWireDocumentSyncSnapshot): boolean {
        if (snapshot.text.length <= this.options.maxSyncedDocumentChars) return true;
        this.options.logger?.warn("skipping document sync: document too large", {
            uri: snapshot.uri,
            length: snapshot.text.length,
        });
        return false;
    }
}
