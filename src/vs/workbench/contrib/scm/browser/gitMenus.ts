import type { ISubmenuContribution } from "../../../../platform/actions/common/iMenuContribution.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { viewMenuVisible } from "../../../browser/actions/menuContexts.ts";

import { SCM_CHANGES_VIEW_ID } from "../common/scmViews.ts";

/**
 * Подменю меню «⋯» секции CHANGES — зеркала submenu-точек git-расширения
 * VS Code (`scm/title`: git.commit / git.changes / git.pullpush / git.branch /
 * git.remotes / git.stash / git.tags). Пункты приходят co-located размещениями
 * commit/staging/sync/branch/stash/remote-экшенов; пустое подменю резолвер
 * меню выбрасывает автоматически — точки «зажигаются» по мере наполнения.
 */
export const GitCommitMenu = new MenuId("GitCommitMenu");
export const GitChangesMenu = new MenuId("GitChangesMenu");
export const GitPullPushMenu = new MenuId("GitPullPushMenu");
export const GitBranchMenu = new MenuId("GitBranchMenu");
export const GitRemotesMenu = new MenuId("GitRemotesMenu");
export const GitStashMenu = new MenuId("GitStashMenu");
export const GitTagsMenu = new MenuId("GitTagsMenu");

const inChangesMenu = viewMenuVisible(SCM_CHANGES_VIEW_ID);

/** Submenu-каркас «⋯» CHANGES: группа 3_git_menus между 2_git_top и 9_footer. */
export const GIT_MENU_SUBMENUS: readonly ISubmenuContribution[] = [
    { menuId: MenuId.ViewTitle, submenu: GitCommitMenu, title: "Commit", group: "3_git_menus", order: 10, visible: inChangesMenu },
    { menuId: MenuId.ViewTitle, submenu: GitChangesMenu, title: "Changes", group: "3_git_menus", order: 20, visible: inChangesMenu },
    { menuId: MenuId.ViewTitle, submenu: GitPullPushMenu, title: "Pull, Push", group: "3_git_menus", order: 30, visible: inChangesMenu },
    { menuId: MenuId.ViewTitle, submenu: GitBranchMenu, title: "Branch", group: "3_git_menus", order: 40, visible: inChangesMenu },
    { menuId: MenuId.ViewTitle, submenu: GitRemotesMenu, title: "Remote", group: "3_git_menus", order: 50, visible: inChangesMenu },
    { menuId: MenuId.ViewTitle, submenu: GitStashMenu, title: "Stash", group: "3_git_menus", order: 60, visible: inChangesMenu },
    { menuId: MenuId.ViewTitle, submenu: GitTagsMenu, title: "Tags", group: "3_git_menus", order: 70, visible: inChangesMenu },
];
