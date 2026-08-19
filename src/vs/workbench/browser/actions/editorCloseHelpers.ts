import type { ServiceAccessor } from "../../../platform/instantiation/common/diContainer.ts";
import { DialogServiceDIToken } from "../../services/dialogs/browser/dialogService.ts";
import type { EditorGroup } from "../../services/editor/browser/editorGroupModel.ts";
import type { EditorService } from "../../services/editor/browser/editorService.ts";
import { DiffEditorPane2 } from "../parts/editor/diffEditorPane2.ts";
import type { IEditorPane } from "../parts/editor/iEditorPane.ts";
import { TextEditorPane } from "../parts/editor/textEditorPane.ts";

/**
 * Последовательно закрывает перечисленные вкладки группы с confirm-диалогом по
 * каждому несохранённому документу (последняя вкладка документа). Cancel
 * прерывает всю серию (US-48/49-семантика quit-флоу); возвращает true, если
 * закрыты все цели.
 *
 * Целями держим сами панели, а не номера: между диалогами список вкладок
 * сдвигается (закрытая вкладка убирает индекс), а панель остаётся собой —
 * поэтому позиция ищется заново прямо перед закрытием. Порядок закрытия —
 * порядок `indices`: он же порядок confirm-диалогов, и вызывающий им управляет.
 */
export async function closeTabsWithConfirm(
    accessor: ServiceAccessor,
    service: EditorService,
    group: EditorGroup,
    indices: readonly number[],
): Promise<boolean> {
    const dialogs = accessor.get(DialogServiceDIToken);
    const targets = indices
        .map((index) => group.getPane(index))
        .filter((pane): pane is IEditorPane => pane !== null);

    for (const pane of targets) {
        if (service.needsCloseConfirm(pane)) {
            // Сохраняемые поверхности вкладки: сама текстовая панель либо
            // dirty-стороны диффа v2, не видимые больше нигде (untitled-пара,
            // файл без вкладки) — needsCloseConfirm гарантирует, что они есть.
            const saveTargets =
                pane instanceof DiffEditorPane2
                    ? service.dirtyExclusiveDiffSides(pane)
                    : /* v8 ignore start -- needsCloseConfirm для не-диффа истинен только у текстовой панели */
                      pane instanceof TextEditorPane
                      ? [pane]
                      : [];
            /* v8 ignore stop */
            const choice = await dialogs.confirmSave(saveTargets.map((target) => target.label).join(", "));
            if (choice === "cancel") return false;
            if (choice === "save") {
                for (const target of saveTargets) await target.save({ overwrite: true });
            }
        }
        const index = group.getPanes().indexOf(pane);
        /* v8 ignore start -- цель могла закрыться из диалога только вместе со всей группой */
        if (index < 0) continue;
        /* v8 ignore stop */
        group.closeTab(index);
    }
    return true;
}

/**
 * Закрывает группу целиком — с хвоста, как это делает Ctrl+K W: диалоги по
 * несохранённым идут справа налево, а cancel прерывает серию.
 */
export function closeGroupEditorsWithConfirm(
    accessor: ServiceAccessor,
    service: EditorService,
    group: EditorGroup,
): Promise<boolean> {
    const indices = group.getPanes().map((_pane, index) => index).reverse();
    return closeTabsWithConfirm(accessor, service, group, indices);
}
