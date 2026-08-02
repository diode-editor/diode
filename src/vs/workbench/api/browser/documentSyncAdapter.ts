import type { TextEditorPane } from "../../browser/parts/editor/textEditorPane.ts";
import type { EditorService } from "../../services/editor/browser/editorService.ts";
import type { ExtensionHost } from "../../services/extensions/node/extensionHost.ts";
import type { IWireDocumentSyncSnapshot } from "../common/wireTypes.ts";

/** Снапшот документа редактора для document sync push'а (`editor.didOpen`/`didChange`). */
export function documentSyncSnapshotOf(editor: TextEditorPane): IWireDocumentSyncSnapshot {
    return {
        uri: editor.uri.toString(),
        languageId: editor.languageId,
        version: editor.model.document.versionId,
        text: editor.getText(),
        isDirty: editor.isModified,
    };
}

/** Снапшот активного документа группы; `null` — активного редактора нет. */
export function activeDocumentSnapshot(group: EditorService): IWireDocumentSyncSnapshot | null {
    const editor = group.getActiveEditor();
    return editor === null ? null : documentSyncSnapshotOf(editor);
}

/**
 * Продюсер document sync (core → host): `didOpen` на смену активного редактора,
 * `didChange` на правку его содержимого. Host сам гейтит push по подписке
 * subprocess'а (см. `workspace.updateSubscriptions`), поэтому без LS-подобных
 * расширений RPC не гоняется. Подписка живёт до конца жизни группы — как
 * остальная проводка extension host'а в модуле.
 */
export function bindDocumentSync(group: EditorService, host: ExtensionHost): void {
    let contentSub: { dispose(): void } | null = null;
    const bindActive = (editor: TextEditorPane | null): void => {
        contentSub?.dispose();
        contentSub = null;
        if (editor === null) return;
        host.didOpenTextDocument(documentSyncSnapshotOf(editor));
        contentSub = editor.onDidChangeContent(() => {
            host.didChangeTextDocument(documentSyncSnapshotOf(editor));
        });
    };
    group.onActiveEditorChanged(bindActive);
    bindActive(group.getActiveEditor());
}
