import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { viewMenuVisible } from "../../../browser/actions/menuContexts.ts";
import { SCM_GRAPH_VIEW_ID } from "../common/scmViews.ts";

import { runGitOp } from "./gitOpClient.ts";
import { GRAPH_LOAD_MORE_COMMAND } from "./graphViewComponent.ts";
import { REFRESH_ICON } from "./refreshActions.ts";

/** Same op as `git.refresh`, but the spinner goes to GRAPH; before the extension activates, a silent no-op. */
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
    async run(accessor) {
        await runGitOp(accessor, "refresh", undefined, { viewId: SCM_GRAPH_VIEW_ID });
    },
};

/** The extension owns the limit (`logLoadMore` grows it by `scm.graph.pageSize`); the core only asks. */
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
