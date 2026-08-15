import { Uri } from "../../../../base/common/uri.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { DiffEditorPane2 } from "../../../browser/parts/editor/diffEditorPane2.ts";
import { FileSystemProviderRegistryDIToken } from "../../../common/coreTokens.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import type { IOpenDiffPairOptions } from "../../diff/browser/openDiffPair.ts";
import { openDiffPair, showCompareNotice } from "../../diff/browser/openDiffPair.ts";

import { OriginalResourceProviderDIToken } from "./quickDiffService.ts";

export { COMPARE_NOTICE_MS } from "../../diff/browser/openDiffPair.ts";

/** `"no-original"` = сравнивать не с чем; реакцию (notice, открыть файл) выбирает вызывающий. */
export type OpenDiffResult = "opened" | "no-original";

/**
 * «Сравнить с ревизией из git» для произвольного uri, не требуя активного
 * редактора. Оригинал даёт SCM-расширение (`IOriginalResourceProvider`) через
 * реестр провайдеров ФС; modified-сторона — открытый буфер этого uri
 * (несохранённые правки видны), а без него — снимок с диска; файл, не
 * читающийся с диска (удалён, status D), даёт дифф «ревизия ↔ пусто».
 * Открытие вкладки, идентичность пары и дедуп — у общего ядра
 * ({@link openDiffPair}).
 */
export async function openDiffWithHead(accessor: ServiceAccessor, uri: Uri, ref = "HEAD"): Promise<OpenDiffResult> {
    const options = await buildHeadPairOptions(accessor, uri, ref);
    if (options === null) return "no-original";
    const result = await openDiffPair(accessor, options);
    return result === "opened" ? "opened" : "no-original";
}

/**
 * Пара «ревизия из git ↔ файл» как опции сравнения — общая заготовка обычной
 * смотрелки и диффа v2. Политики «не читается»: справа всегда «пусто» — файл,
 * удалённый в рабочем дереве (status D), даёт дифф «ревизия ↔ пусто». Слева
 * зависит от того, чья это ревизия: для HEAD сбой чтения — это сломанный git
 * (untracked расширение отсекло раньше), отказ честнее пустоты; для явно
 * выбранного ref «файла на ревизии нет» — штатный случай, весь дифф добавлен.
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

/** `git:`-ресурс ревизии, либо `null`, если сравнивать не с чем. */
async function resolveOriginalUri(accessor: ServiceAccessor, uri: Uri, ref: string): Promise<Uri | null> {
    try {
        const original = await accessor.get(OriginalResourceProviderDIToken).provideOriginalResource(uri, ref);
        if (original === null) return null;
        if (!accessor.get(FileSystemProviderRegistryDIToken).hasProvider(original.scheme)) return null;
        return original;
    } catch {
        return null;
    }
}

/** Палитра: сравнивает активный файл; без активного редактора — тихий no-op. */
async function compareWithHead(accessor: ServiceAccessor): Promise<void> {
    const editors = accessor.get(EditorServiceDIToken);
    // На самой дифф-вкладке повторный вызов обязан целиться в её исходный файл,
    // а не в ресурс активной стороны (у снимка он синтетический).
    const activeTab = editors.getActiveTabPane();
    const uri = activeTab instanceof DiffEditorPane2 ? activeTab.modifiedUri : (editors.getActiveEditor()?.uri ?? null);
    if (uri === null) return;

    const result = await openDiffWithHead(accessor, uri);
    if (result === "no-original") {
        // Untracked, вне репозитория, git недоступен, SCM-расширение не поднялось —
        // для пользователя всё это одно и то же: сравнивать не с чем.
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
