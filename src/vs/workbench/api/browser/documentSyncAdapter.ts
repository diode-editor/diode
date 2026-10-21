import { DisposableStore } from "../../../base/common/lifecycle.ts";
import type { IModelContentChangedEvent } from "../../../editor/common/model/iDocumentContentChange.ts";
import type { BaseTextEditorModel } from "../../common/editor/textEditorModel.ts";
import type { IEditorGroupsService } from "../../services/editor/common/editorGroupsService.ts";
import type { IEditorService } from "../../services/editor/common/editorService.ts";
import type { IDocumentSyncTarget } from "../common/iDocumentSyncTarget.ts";
import type { IWireDocumentChangedEvent, IWireDocumentSyncSnapshot } from "../common/wireTypes.ts";

export function documentSyncSnapshotOfModel(model: BaseTextEditorModel): IWireDocumentSyncSnapshot {
    return {
        uri: model.uri.toString(),
        languageId: model.languageId,
        version: model.document.versionId,
        text: model.getText(),
        isDirty: model.isModified,
    };
}

/** Правки — в порядке применения, версия — модели после батча. */
export function documentChangedEventOfModel(
    model: BaseTextEditorModel,
    event: IModelContentChangedEvent,
): IWireDocumentChangedEvent {
    return {
        uri: model.uri.toString(),
        version: event.versionId,
        changes: event.changes.map(({ range, text }) => ({ range, text })),
        isDirty: model.isModified,
    };
}

/**
 * Хост пушит их `editor.didOpen` на `host.ready`: `workspace.textDocuments` должен быть полон
 * до активации расширений (стоковый vscode-languageclient читает его на `start()`).
 */
export function openDocumentSnapshots(group: IEditorService): IWireDocumentSyncSnapshot[] {
    return [...openDocumentModels(group)].map(documentSyncSnapshotOfModel);
}

/** Плюс безымянные буферы без вкладки: `openTextDocument({ content })` открывает документ до показа, как в эталоне. */
function openDocumentModels(group: IEditorService): Set<BaseTextEditorModel> {
    const models = new Set<BaseTextEditorModel>();
    for (const editor of group.getTextSurfaces()) models.add(editor.model);
    for (const model of group.getUntitledModelsWithoutEditor()) models.add(model);
    return models;
}

type IOpenedDocument = Pick<IWireDocumentSyncSnapshot, "uri" | "languageId">;

interface ITrackedDocument {
    openedAs: IOpenedDocument;
    readonly subscriptions: DisposableStore;
}

/**
 * Подписка на МОДЕЛЬ, а не на вкладку: документ в двух группах даёт один didChange (AS-11).
 * Панели Output не синхронизируются: их строка, уехав субпроцессу правкой, порождала бы
 * новую строку канала «Extension Host (RPC)».
 */
export function bindDocumentSync(group: IEditorService, groups: IEditorGroupsService, host: IDocumentSyncTarget): void {
    const tracked = new Map<BaseTextEditorModel, ITrackedDocument>();

    const openModel = (model: BaseTextEditorModel): IOpenedDocument => {
        const snapshot = documentSyncSnapshotOfModel(model);
        host.didOpenTextDocument(snapshot);
        return { uri: snapshot.uri, languageId: snapshot.languageId };
    };

    /** Новый uri (Save As) или язык — для расширений другой документ, как в эталоне: didClose и didOpen. */
    const resyncIdentity = (model: BaseTextEditorModel, record: ITrackedDocument): void => {
        const { uri, languageId } = record.openedAs;
        if (uri === model.uri.toString() && languageId === model.languageId) return;
        host.didCloseTextDocument(uri);
        record.openedAs = openModel(model);
    };

    const trackModel = (model: BaseTextEditorModel): void => {
        const known = tracked.get(model);
        if (known !== undefined) {
            resyncIdentity(model, known);
            return;
        }
        const subscriptions = new DisposableStore();
        const record: ITrackedDocument = { openedAs: openModel(model), subscriptions };
        tracked.set(model, record);
        // Без коалесинга: запрос провайдера, ушедший следом, едет по тому же каналу ПОСЛЕ
        // правки — порядок сообщений заменяет версию в запросе, как у `$acceptModelChanged`.
        subscriptions.add(
            model.document.onDidChangeModelContent((event) => {
                if (event.isFlush) host.didChangeTextDocument(documentSyncSnapshotOfModel(model));
                else host.didChangeTextDocumentContent(documentChangedEventOfModel(model, event));
            }),
        );
        // Язык меняется и без смены набора вкладок: Save As шлёт его раньше, чем вкладки узнают о сохранении.
        subscriptions.add(
            model.onDidChangeLanguage(() => {
                resyncIdentity(model, record);
            }),
        );
    };

    const reconcile = (): void => {
        const alive = openDocumentModels(group);
        for (const [model, record] of [...tracked]) {
            if (alive.has(model)) continue;
            record.subscriptions.dispose();
            tracked.delete(model);
            host.didCloseTextDocument(record.openedAs.uri);
        }
        for (const model of alive) trackModel(model);
    };

    group.onDidChangeEditors(reconcile);
    // Stryker disable next-line CallExpression: эквивалентен — перенос и слияние вкладок и так приходят через onDidChangeEditors, подписка страхует
    groups.onDidGroupsChange(reconcile);
    reconcile();
}
