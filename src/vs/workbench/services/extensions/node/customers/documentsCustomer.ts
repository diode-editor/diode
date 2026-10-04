import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { ILogger } from "../../../../../platform/log/common/iLogger.ts";
import type { IDocumentSyncTarget } from "../../../../api/common/iDocumentSyncTarget.ts";
import type { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import {
    type IWireDocumentChangedEvent,
    type IWireDocumentSyncSnapshot,
    requestWillSaveEdits,
} from "../../../../api/common/wireTypes.ts";
import type { ISaveEdit, ISaveSnapshot } from "../../../textfile/common/iSaveParticipant.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";

/** Порог, выше которого снапшот документа не гоняется через RPC (8 MB). */
export const MAX_WILL_SAVE_TEXT_BYTES = 8 * 1024 * 1024;

export interface IDocumentsCustomerOptions {
    /** Тайм-аут на ответ участника will-save, мс. */
    readonly willSaveTimeoutMs: number;
    /** Снапшоты открытых документов для семени `editor.didOpen` на handshake. */
    readonly openDocumentsProvider: (() => IWireDocumentSyncSnapshot[]) | undefined;
    readonly logger: ILogger | undefined;
}

/** Состояние одного спавна: канал, подписки субпроцесса и синхронизированные документы. */
interface ISpawnDocuments {
    readonly rpc: RpcEndpoint;
    /** Есть ли в субпроцессе активные подписки на will/did-save (см. `workspace.updateSubscriptions`). */
    willSaveSubscribed: boolean;
    didSaveSubscribed: boolean;
    /**
     * Документы, зеркало которых субпроцесс держит (uri): ушёл снапшот
     * didOpen/семени, и правки им идут дельтой. Правка по документу вне набора
     * не шлётся — применённая к чужому тексту, она испортила бы зеркало.
     */
    readonly synced: Set<string>;
}

/**
 * Документы для расширений: участники will/did-save и document sync
 * (`workspace.textDocuments`, onDidOpen/Change/Close). Субпроцесс держит
 * зеркало документа: снапшот на открытии, дальше — правки батчей модели, каждая
 * синхронно и без коалесинга (порядок сообщений в одном канале заменяет версию
 * в запросе — как `$acceptModelChanged` эталона). Подписки субпроцесса и набор
 * синхронизированных документов живут один спавн; семя открытых документов хост
 * шлёт на своём месте последовательности handshake ({@link pushInitialState}).
 */
export class DocumentsCustomer implements IExtensionHostCustomer, IDocumentSyncTarget {
    private live: ISpawnDocuments | null = null;

    public constructor(private readonly options: IDocumentsCustomerOptions) {}

    /**
     * Семя handshake: наполняем `workspace.textDocuments` открытыми документами
     * ДО первой активации — стоковый vscode-languageclient читает его на start().
     * Мимо защитного лимита: семя — снимок того, что уже открыто.
     */
    public pushInitialState(): void {
        const live = this.live;
        if (live === null) return;
        const openDocuments = this.options.openDocumentsProvider?.() ?? [];
        for (const snapshot of openDocuments) {
            live.rpc.notify("editor.didOpen", snapshot);
            live.synced.add(snapshot.uri);
        }
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
     * Открытие документа (`editor.didOpen`): полный снапшот — с него начинается
     * зеркало в субпроцессе, пополняется `workspace.textDocuments` и фаерится
     * `onDidOpenTextDocument` (на нём document sync стокового
     * vscode-languageclient). No-op без субпроцесса и для слишком больших
     * документов — такой документ субпроцессу не синхронизируется вовсе.
     */
    public didOpenTextDocument(snapshot: IWireDocumentSyncSnapshot): void {
        const live = this.live;
        if (live === null || !this.fitsDocumentSyncLimit(snapshot)) return;
        live.rpc.notify("editor.didOpen", snapshot);
        live.synced.add(snapshot.uri);
    }

    /**
     * Содержимое заменено целиком (flush: перечитка с диска): полный снапшот
     * вместо правок. Синхронизированный документ, переросший защитный лимит,
     * субпроцессу закрывается — оставленное зеркало разошлось бы с документом
     * навсегда; несинхронизированный, ставший подъёмным, — открывается.
     */
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

    /**
     * Правки батча модели (`editor.didChange` дельтой) — сразу, без коалесинга:
     * запрос провайдера, ушедший следом, едет по тому же каналу после них.
     * Только синхронизированным документам.
     */
    public didChangeTextDocumentContent(event: IWireDocumentChangedEvent): void {
        const live = this.live;
        if (!live?.synced.has(event.uri)) return;
        live.rpc.notify("editor.didChange", event);
    }

    /**
     * Закрытие документа (`editor.didClose` → `onDidCloseTextDocument` + сброс
     * didOpen-дедупа в субпроцессе) — тем, что были синхронизированы.
     */
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
        // Субпроцесс сообщает, есть ли подписчики на will/did-save. Без них хост
        // не гоняет RPC на сохранении (save остаётся синхронным).
        store.add(
            rpc.handleNotification("workspace.updateSubscriptions", (params) => {
                // Флаг `documentSync` хосту больше не нужен: правки — дельтой и
                // всем синхронизированным документам (пропуск любой испортил бы
                // зеркало), а не только при подписчиках onDidChangeTextDocument.
                const p = params as { willSave?: unknown; didSave?: unknown };
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
