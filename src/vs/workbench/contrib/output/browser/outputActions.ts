import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseChord } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { OUTPUT_VIEW_ID } from "../../../services/output/common/output.ts";

import { OutputComponentDIToken } from "./outputComponent.ts";

/**
 * Показать/скрыть Output (VS Code `workbench.action.output.toggleOutput`).
 * Поведение — как у Toggle Problems: показать и сфокусировать, а если вкладка
 * уже видима — свернуть часть, где он стоит.
 *
 * Кейбинд — `ctrl+k ctrl+h`, как у VS Code **на Linux**
 * (`output.contribution.ts`): их primary `Ctrl+Shift+U` там занят IBus, а у нас
 * `Ctrl+Shift+<буква>` терминал вообще не кодирует.
 */
export const toggleOutputAction: CommandAction = {
    id: "workbench.action.output.toggleOutput",
    title: "View: Toggle Output",
    shortTitle: "Output",
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "3_views", order: 30 }],
    keybinding: parseChord("ctrl+k ctrl+h"),
    run(accessor) {
        // Вид Output может стоять не в панели (перенос во вторичную панель):
        // показ и скрытие — там, где он стоит.
        const views = accessor.get(ViewsServiceDIToken);
        if (views.isViewShown(OUTPUT_VIEW_ID)) {
            views.closeView(OUTPUT_VIEW_ID);
            return;
        }
        views.openView(OUTPUT_VIEW_ID, false, false);
        accessor.get(OutputComponentDIToken).focus();
    },
};

/** Экшены панели Output. Фича отдаёт их одним массивом; регистрирует агрегатор (`WORKBENCH_ACTIONS`). */
export const OUTPUT_ACTIONS: readonly CommandAction[] = [toggleOutputAction];
