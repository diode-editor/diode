import { Uri } from "../../../../base/common/uri.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { DiffEditorPane2 } from "../../../browser/parts/editor/diffEditorPane2.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import type { IOpenDiffPairOptions } from "../../diff/browser/openDiffPair.ts";
import { openDiffPair, showCompareNotice } from "../../diff/browser/openDiffPair.ts";

import { OriginalResourceProviderDIToken } from "./quickDiffService.ts";

export { COMPARE_NOTICE_MS } from "../../diff/browser/openDiffPair.ts";

/** `"no-original"` = сравнивать не с чем; реакцию (notice, открыть файл) выбирает вызывающий. */
export type OpenDiffResult = "opened" | "no-original";

/**
 * modified-сторона — открытый буфер uri (несохранённые правки видны), без него — снимок
 * с диска; удалённый файл (status D) даёт дифф «ревизия ↔ пусто».
 */
export async function openDiffWithHead(accessor: ServiceAccessor, uri: Uri, ref = "HEAD"): Promise<OpenDiffResult> {
    const options = await buildHeadPairOptions(accessor, uri, ref);
    if (options === null) return "no-original";
    const result = await openDiffPair(accessor, options);
    return result === "opened" ? "opened" : "no-original";
}

/**
 * Справа сбой чтения — всегда «пусто» (status D). Слева: для HEAD сбой — сломанный git
 * (untracked отсекло расширение), отказ честнее пустоты; для явного ref «файла нет» —
 * штатно, весь дифф добавлен.
 */
export async function buildHeadPairOptions(
    accessor: ServiceAccessor,
    uri: Uri,
    ref: string,
): Promise<IOpenDiffPairOptions | null> {
    const originalUri = await resolveOriginalUri(accessor, uri, ref);
    if (originalUri === null) return null;

    const editors = accessor.get(EditorServiceDIToken);
    // Метка — как у открытой вкладки файла, в какой бы группе она ни была.
    const pane = editors.getEditors().find((p) => p.uri.toString() === uri.toString());
    const label = pane ? editors.displayName(pane) : uri.path.slice(uri.path.lastIndexOf("/") + 1);

    return {
        original: {
            uri: originalUri,
            label: ref,
            identity: originalUri.toString(),
            onMissing: ref === "HEAD" ? "error" : "empty",
        },
        modified: { uri, label, identity: uri.toString(), onMissing: "empty" },
        title: `${label} ↔ ${ref}`,
    };
}

async function resolveOriginalUri(accessor: ServiceAccessor, uri: Uri, ref: string): Promise<Uri | null> {
    try {
        const original = await accessor.get(OriginalResourceProviderDIToken).provideOriginalResource(uri, ref);
        // Схема без провайдера не проверяется: HEAD не прочитается, исход тот же.
        return original;
    } catch {
        return null;
    }
}

async function compareWithHead(accessor: ServiceAccessor): Promise<void> {
    const editors = accessor.get(EditorServiceDIToken);
    // На самой дифф-вкладке повторный вызов обязан целиться в её исходный файл,
    // а не в ресурс активной стороны (у снимка он синтетический).
    const activeTab = editors.getActiveTabPane();
    const uri = activeTab instanceof DiffEditorPane2 ? activeTab.modifiedUri : (editors.getActiveEditor()?.uri ?? null);
    if (uri === null) return;

    const result = await openDiffWithHead(accessor, uri);
    if (result === "no-original") {
        // Untracked, вне репозитория, git недоступен — для пользователя одно и то же.
        showCompareNotice(accessor, "No changes to compare: the file has no version in git");
    }
}

export const compareWithHeadAction: CommandAction = {
    id: "diode.scm.compareWithHead",
    title: "Git: Compare Active File with HEAD",
    run(accessor) {
        void compareWithHead(accessor);
    },
};
