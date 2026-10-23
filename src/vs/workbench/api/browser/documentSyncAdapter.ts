import { DisposableStore } from "../../../base/common/lifecycle.ts";
import type { IModelContentChangedEvent } from "../../../editor/common/model/iDocumentContentChange.ts";
import type { BaseTextEditorModel } from "../../common/editor/textEditorModel.ts";
import type { IEditorGroupsService } from "../../services/editor/common/editorGroupsService.ts";
import type { IEditorService } from "../../services/editor/common/editorService.ts";
import type { IDocumentSyncSource, IDocumentSyncTarget } from "../common/iDocumentSyncTarget.ts";
import type { IWireDocumentChangedEvent } from "../common/wireTypes.ts";

/**
 * The text is not built here: the target reads it only when it sends the document (live subprocess, within
 * the sync limit). On a 200k-line file the built text is a 13 MB string that a host without a subprocess
 * would drop on the floor.
 */
export function documentSyncSourceOfModel(model: BaseTextEditorModel): IDocumentSyncSource {
    const document = model.document;
    return {
        uri: model.uri.toString(),
        languageId: model.languageId,
        version: document.versionId,
        isDirty: model.isModified,
        length: document.getValueLength(),
        getText: () => document.getText(),
    };
}

/** Edits are in application order; the version is the model's after the batch. */
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
 * The host pushes them as `editor.didOpen` on `host.ready`: `workspace.textDocuments` must be complete
 * before extensions activate (the stock vscode-languageclient reads it on `start()`).
 */
export function openDocumentSyncSources(group: IEditorService): IDocumentSyncSource[] {
    return [...openDocumentModels(group)].map(documentSyncSourceOfModel);
}

/** Plus untitled buffers without a tab: `openTextDocument({ content })` opens the document before showing it, as upstream. */
function openDocumentModels(group: IEditorService): Set<BaseTextEditorModel> {
    const models = new Set<BaseTextEditorModel>();
    for (const editor of group.getTextSurfaces()) models.add(editor.model);
    for (const model of group.getUntitledModelsWithoutEditor()) models.add(model);
    return models;
}

type IOpenedDocument = Pick<IDocumentSyncSource, "uri" | "languageId">;

interface ITrackedDocument {
    openedAs: IOpenedDocument;
    readonly subscriptions: DisposableStore;
}

/**
 * Subscribes to the MODEL, not the tab: a document in two groups yields one didChange (AS-11).
 * Output panels are not synced: their line, sent to the subprocess as an edit, would produce
 * a new line in the "Extension Host (RPC)" channel.
 */
export function bindDocumentSync(group: IEditorService, groups: IEditorGroupsService, host: IDocumentSyncTarget): void {
    const tracked = new Map<BaseTextEditorModel, ITrackedDocument>();

    const openModel = (model: BaseTextEditorModel): IOpenedDocument => {
        const source = documentSyncSourceOfModel(model);
        host.didOpenTextDocument(source);
        return { uri: source.uri, languageId: source.languageId };
    };

    /** A new uri (Save As) or language is a different document for extensions, as upstream: didClose and didOpen. */
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
        // No coalescing: a provider request sent right after travels on the same channel AFTER
        // the edit; message order stands in for a version in the request, like `$acceptModelChanged`.
        subscriptions.add(
            model.document.onDidChangeModelContent((event) => {
                if (event.isFlush) host.didChangeTextDocument(documentSyncSourceOfModel(model));
                else host.didChangeTextDocumentContent(documentChangedEventOfModel(model, event));
            }),
        );
        // The language changes without a change in the tab set too: Save As sends it before the tabs learn of the save.
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
    // Stryker disable next-line CallExpression: equivalent: moving and merging tabs already arrive via onDidChangeEditors, the subscription is a safeguard
    groups.onDidGroupsChange(reconcile);
    reconcile();
}
