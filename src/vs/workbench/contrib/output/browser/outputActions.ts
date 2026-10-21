import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseChord } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { OUTPUT_VIEW_ID } from "../../../services/output/common/output.ts";

import { OutputComponentDIToken } from "./outputComponent.ts";

/** `ctrl+k ctrl+h` — like VS Code on Linux (`output.contribution.ts`): the terminal does not encode `Ctrl+Shift+<letter>`. */
export const toggleOutputAction: CommandAction = {
    id: "workbench.action.output.toggleOutput",
    title: "View: Toggle Output",
    shortTitle: "Output",
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "3_views", order: 30 }],
    keybinding: parseChord("ctrl+k ctrl+h"),
    run(accessor) {
        // The Output view may live outside the panel (moved to the secondary panel):
        // show and hide it where it is.
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
