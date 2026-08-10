import type { TextEditorPane } from "../../browser/parts/editor/textEditorPane.ts";
import type { EditorService } from "../../services/editor/browser/editorService.ts";
import type { TextFileModel } from "../../services/textfile/common/textFileModel.ts";
import type { ExtensionHost } from "../../services/extensions/node/extensionHost.ts";
import type { IWireDocumentSyncSnapshot } from "../common/wireTypes.ts";

/** Снапшот документа модели для document sync push'а (`editor.didOpen`/`didChange`). */
export function documentSyncSnapshotOfModel(model: TextFileModel): IWireDocumentSyncSnapshot {
    return {
        uri: model.uri.toString(),
        languageId: model.languageId,
        version: model.document.versionId,
        text: model.getText(),
        isDirty: model.isModified,
    };
}

/** Снапшот документа редактора для document sync push'а (`editor.didOpen`/`didChange`). */
export function documentSyncSnapshotOf(editor: TextEditorPane): IWireDocumentSyncSnapshot {
    return documentSyncSnapshotOfModel(editor.model);
}

/**
 * Снапшоты ВСЕХ открытых документов (по одному на модель — документ в двух
 * группах не дублируется). Хост пушит их как `editor.didOpen` на `host.ready`,
 * чтобы `workspace.textDocuments` был полон ДО активации расширений (стоковый
 * vscode-languageclient читает его на `start()`).
 */
export function openDocumentSnapshots(group: EditorService): IWireDocumentSyncSnapshot[] {
    const snapshots: IWireDocumentSyncSnapshot[] = [];
    const seen = new Set<TextFileModel>();
    for (const editor of group.getEditors()) {
        if (seen.has(editor.model)) continue;
        seen.add(editor.model);
        snapshots.push(documentSyncSnapshotOfModel(editor.model));
    }
    return snapshots;
}

/**
 * Продюсер document sync (core → host), пер-ДОКУМЕНТНЫЙ (AS-11): `didOpen` на
 * первое открытие ресурса, `didChange` на правку его модели — в какой бы группе
 * (и активна ли она) правка ни случилась; `didClose` — когда закрыта последняя
 * вкладка документа. Подписка на МОДЕЛЬ, не на вкладку: документ в двух группах
 * даёт один didChange, а не два. Host сам гейтит didChange по подписке
 * subprocess'а (см. `workspace.updateSubscriptions`), поэтому без LS-подобных
 * расширений RPC не гоняется.
 */
export function bindDocumentSync(group: EditorService, host: ExtensionHost): void {
    /** Живые подписки по модели; смерть последней вкладки снимает и шлёт didClose. */
    const tracked = new Map<TextFileModel, { dispose(): void }>();

    const trackModel = (model: TextFileModel): void => {
        if (tracked.has(model)) return;
        host.didOpenTextDocument(documentSyncSnapshotOfModel(model));
        tracked.set(
            model,
            model.onDidChangeContent(() => {
                host.didChangeTextDocument(documentSyncSnapshotOfModel(model));
            }),
        );
    };

    /** Согласует множество отслеживаемых моделей с открытыми вкладками. */
    const reconcile = (): void => {
        const alive = new Set<TextFileModel>();
        for (const editor of group.getEditors()) alive.add(editor.model);
        for (const [model, subscription] of [...tracked]) {
            if (alive.has(model)) continue;
            subscription.dispose();
            tracked.delete(model);
            host.didCloseTextDocument(model.uri.toString());
        }
        for (const model of alive) trackModel(model);
    };

    // Открытия/закрытия вкладок любой группы + структурные изменения полосы.
    group.onDidChangeEditors(reconcile);
    group.onDidGroupsChange(reconcile);
    reconcile();
}
