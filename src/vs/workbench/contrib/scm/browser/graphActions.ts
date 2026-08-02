import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { viewMenuVisible } from "../../../browser/actions/menuContexts.ts";

import { SCM_GRAPH_VIEW_ID } from "./graphViewComponent.ts";

/**
 * Ручное обновление view GRAPH — пункт Refresh в меню «⋯» секции. Делегирует
 * команде `git.refresh` расширения (паттерн {@link CommandOriginalResourceProvider}):
 * до активации расширения команды нет — тогда тихий no-op, как у quickDiff.
 */
export const scmGraphRefreshAction: CommandAction = {
    id: "scm.graph.refresh",
    title: "Source Control: Refresh Graph",
    shortTitle: "Refresh",
    when: "scmViewletVisible",
    menus: [
        {
            menuId: MenuId.ViewMoreActions,
            group: "1_actions",
            order: 10,
            visible: viewMenuVisible(SCM_GRAPH_VIEW_ID),
        },
    ],
    run(accessor) {
        const commands = accessor.get(CommandRegistryDIToken);
        if (commands.has("git.refresh")) void commands.execute("git.refresh");
    },
};
