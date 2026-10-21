import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { viewMenuVisible } from "../../../browser/actions/menuContexts.ts";
import { SCM_GRAPH_VIEW_ID } from "../common/scmViews.ts";

import { runGitOp, withGitProgress } from "./gitOpClient.ts";
import { GRAPH_LOAD_MORE_COMMAND } from "./graphViewComponent.ts";

/** nf-cod-refresh. */
const REFRESH_ICON = "\ueb37";

/** До активации расширения команды `git.refresh` нет — тихий no-op. */
export const scmGraphRefreshAction: CommandAction = {
    id: "scm.graph.refresh",
    title: "Source Control: Refresh Graph",
    shortTitle: "Refresh",
    when: "scmViewletVisible",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 10,
            icon: REFRESH_ICON,
            visible: viewMenuVisible(SCM_GRAPH_VIEW_ID),
        },
    ],
    run(accessor) {
        const commands = accessor.get(CommandRegistryDIToken);
        if (!commands.has("git.refresh")) return undefined;
        // Промис прокси-команды не выбрасываем: его держит спиннер.
        return withGitProgress(accessor, "refresh", () => Promise.resolve(commands.execute("git.refresh")));
    },
};

/** Предел держит расширение (`logLoadMore` растит его на `scm.graph.pageSize`); ядро только просит. */
export const scmGraphLoadMoreAction: CommandAction = {
    id: GRAPH_LOAD_MORE_COMMAND,
    title: "Source Control: Load More Commits",
    shortTitle: "Load More",
    when: "gitHasRepo",
    menus: [
        {
            menuId: MenuId.ViewTitle,
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
