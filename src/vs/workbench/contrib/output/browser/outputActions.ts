import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseChord } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { PanelServiceDIToken } from "../../../browser/parts/panel/panelService.ts";
import { LayoutServiceDIToken } from "../../../services/layout/browser/layoutService.ts";
import { OUTPUT_VIEW_ID } from "../../../services/output/common/output.ts";

import { OutputComponentDIToken } from "./outputComponent.ts";

/**
 * Показать/скрыть Output (VS Code `workbench.action.output.toggleOutput`).
 * Поведение — как у Toggle Problems: показать и сфокусировать, а если вкладка
 * уже видима — свернуть панель.
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
        const layout = accessor.get(LayoutServiceDIToken);
        const panel = accessor.get(PanelServiceDIToken);
        const showing = layout.isPanelVisible() && panel.getActiveViewId() === OUTPUT_VIEW_ID;
        if (showing) {
            layout.setPanelVisible(false);
            return;
        }
        panel.setActiveView(OUTPUT_VIEW_ID);
        layout.setPanelVisible(true);
        accessor.get(OutputComponentDIToken).focus();
    },
};

/** Экшены панели Output. Фича отдаёт их одним массивом; регистрирует агрегатор (`WORKBENCH_ACTIONS`). */
export const OUTPUT_ACTIONS: readonly CommandAction[] = [toggleOutputAction];
