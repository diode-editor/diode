import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { UndoRedoServiceDIToken } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { DiffEditorPane2 } from "../../../browser/parts/editor/diffEditorPane2.ts";
import {
    LanguageServiceDIToken,
    TokenizationRegistryDIToken,
    TokenStyleResolverDIToken,
} from "../../../common/coreTokens.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import { buildHeadPairOptions } from "../../scm/browser/compareWithHeadAction.ts";

import { computeDiffInput, showCompareNotice } from "./openDiffPair.ts";

/**
 * Временный вход диффа v2 (docs/TODO/DiffEditable.md, PR-3): «Compare with
 * HEAD», но вкладка — композиция двух настоящих редакторов. Живёт рядом со
 * старой смотрелкой (другая идентичность вкладки — суффикс `&v2` в query),
 * чтобы сравнивать глазами; миграция всех входов и удаление старой — PR-4.
 */
async function compareWithHeadV2(accessor: ServiceAccessor): Promise<void> {
    const editors = accessor.get(EditorServiceDIToken);
    // На самой v2-вкладке getActiveEditor() отдаёт её сторону (синтетический
    // ресурс) — повторный вызов обязан сравнивать исходный файл вкладки.
    const activeTab = editors.getActiveTabPane();
    const targetUri = activeTab instanceof DiffEditorPane2 ? activeTab.modifiedUri : editors.getActiveEditor()?.uri;
    if (targetUri === null || targetUri === undefined) return;

    const options = await buildHeadPairOptions(accessor, targetUri, "HEAD");
    const input = options === null ? null : await computeDiffInput(accessor, options);
    if (input === null) {
        showCompareNotice(accessor, "No changes to compare: the file has no version in git");
        return;
    }

    const v2Input = {
        ...input,
        uri: input.uri.with({ query: `${input.uri.query}&v2` }),
    };

    const existing = editors.getPanes().find((p) => p.uri.toString() === v2Input.uri.toString());
    if (existing instanceof DiffEditorPane2) {
        existing.setInput(v2Input);
        editors.activateTab(editors.getPanes().indexOf(existing));
        return;
    }

    editors.openPane(
        new DiffEditorPane2(
            accessor.get(LanguageServiceDIToken),
            accessor.get(UndoRedoServiceDIToken),
            accessor.get(TokenizationRegistryDIToken),
            accessor.get(TokenStyleResolverDIToken),
            v2Input,
        ),
    );
}

export const compareWithHeadV2Action: CommandAction = {
    id: "vexx.diff.compareWithHeadV2",
    title: "Git: Compare Active File with HEAD (v2)",
    run(accessor) {
        void compareWithHeadV2(accessor);
    },
};
