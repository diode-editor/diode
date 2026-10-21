import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseChord } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { OUTPUT_VIEW_ID } from "../../../services/output/common/output.ts";

import { OutputComponentDIToken } from "./outputComponent.ts";

/** `ctrl+k ctrl+h` — как у VS Code на Linux (`output.contribution.ts`): `Ctrl+Shift+<буква>` терминал не кодирует. */
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
        views.openView(OUTPUT_VIEW_ID);
        accessor.get(OutputComponentDIToken).focus();
    },
};

export const OUTPUT_ACTIONS: readonly CommandAction[] = [toggleOutputAction];
