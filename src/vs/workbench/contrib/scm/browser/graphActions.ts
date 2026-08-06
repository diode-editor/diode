import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { viewMenuVisible } from "../../../browser/actions/menuContexts.ts";

import { runGitOp } from "./gitOpClient.ts";
import { GRAPH_LOAD_MORE_COMMAND, SCM_GRAPH_VIEW_ID } from "./graphViewComponent.ts";

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

/**
 * Следующая страница истории. Предел держит расширение (операция `logLoadMore`
 * растит его на `scm.graph.pageSize`) — ядро только просит и ждёт новой
 * публикации снимка.
 */
export const scmGraphLoadMoreAction: CommandAction = {
    id: GRAPH_LOAD_MORE_COMMAND,
    title: "Source Control: Load More Commits",
    shortTitle: "Load More",
    when: "gitHasRepo",
    menus: [
        {
            menuId: MenuId.ViewMoreActions,
            group: "1_actions",
            order: 20,
            visible: viewMenuVisible(SCM_GRAPH_VIEW_ID),
            when: "gitHasRepo",
        },
    ],
    async run(accessor) {
        await runGitOp(accessor, "logLoadMore");
    },
};

export const GRAPH_VIEW_ACTIONS: readonly CommandAction[] = [scmGraphRefreshAction, scmGraphLoadMoreAction];
