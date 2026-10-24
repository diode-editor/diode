import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { viewMenuVisible } from "../../../browser/actions/menuContexts.ts";
import { SCM_CHANGES_VIEW_ID } from "../common/scmViews.ts";

import { runGitOp } from "./gitOpClient.ts";

/** nf-cod-refresh: CHANGES and GRAPH titles share the glyph. */
export const REFRESH_ICON = "\ueb37";

/**
 * VS Code `git.refresh` (`scm/title`, group `navigation`). The extension's op queue runs
 * `refreshAll` after every operation and resolves only then, so the spinner holds until the
 * changes, repo state and log are republished; without the extension it is a silent no-op.
 */
export const gitRefreshAction: CommandAction = {
    id: "git.refresh",
    title: "Git: Refresh",
    shortTitle: "Refresh",
    // Not `when`: that scopes keybindings only, the palette filters by enablement (VS Code's
    // `commandPalette` when for this command is `gitOpenRepositoryCount != 0`).
    enablement: "gitHasRepo",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 10,
            icon: REFRESH_ICON,
            visible: viewMenuVisible(SCM_CHANGES_VIEW_ID),
            when: "gitHasRepo",
        },
    ],
    async run(accessor) {
        await runGitOp(accessor, "refresh");
    },
};
