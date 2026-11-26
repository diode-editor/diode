import type { CommandAction, CommandMenuPlacement } from "../../../../platform/actions/common/commandAction.ts";
import type { ISubmenuContribution } from "../../../../platform/actions/common/iMenuContribution.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { viewMenuVisible } from "../../../browser/actions/menuContexts.ts";
import { type ExtensionSortBy, withSortBy } from "../common/extensionQuery.ts";

import { EXTENSIONS_VIEW_ID, ExtensionsComponentDIToken } from "./extensionsComponent.ts";
import { openExtensionsSearch } from "./extensionsSearch.ts";

/**
 * Upstream `extensionsFilterSubMenu` and its `Category` and `Sort By` submenus. Upstream hangs the filter on a
 * funnel inside the search box; our search box has no buttons, so it is a submenu of the view's `...` menu (a
 * deviation). Entries without data in our registry (Featured, Most Popular, Recommended, Recently Published,
 * Built-in, Enabled, Disabled, Workspace Unsupported; sorting by installs, rating, update date) are left out, like
 * upstream leaves out what the gallery's capabilities lack.
 */
export const ExtensionsFilterSubMenu = new MenuId("extensionsFilterSubMenu");
export const ExtensionsCategoryFilterSubMenu = new MenuId("extensionsCategoryFilterSubMenu");
export const ExtensionsSortSubMenu = new MenuId("extensionsSortSubMenu");

/** Upstream `EXTENSION_CATEGORIES` (`platform/extensions/common/extensions.ts`), in its order. */
export const EXTENSION_CATEGORIES: readonly string[] = [
    "AI",
    "Azure",
    "Chat",
    "Data Science",
    "Debuggers",
    "Extension Packs",
    "Education",
    "Formatters",
    "Keymaps",
    "Language Packs",
    "Linters",
    "Machine Learning",
    "Notebooks",
    "Programming Languages",
    "SCM Providers",
    "Snippets",
    "Testing",
    "Themes",
    "Visualization",
    "Other",
];

const HIDDEN_FROM_PALETTE: CommandMenuPlacement = { menuId: MenuId.CommandPalette, when: "false" };

export const EXTENSIONS_FILTER_SUBMENUS: readonly ISubmenuContribution[] = [
    {
        menuId: MenuId.ViewTitle,
        submenu: ExtensionsFilterSubMenu,
        title: "Filter Extensions...",
        group: "0_filter",
        order: 1,
        visible: viewMenuVisible(EXTENSIONS_VIEW_ID),
    },
    {
        menuId: ExtensionsFilterSubMenu,
        submenu: ExtensionsCategoryFilterSubMenu,
        title: "Category",
        group: "2_categories",
        order: 1,
    },
    { menuId: ExtensionsFilterSubMenu, submenu: ExtensionsSortSubMenu, title: "Sort By", group: "4_sort", order: 1 },
];

export const showInstalledExtensionsAction: CommandAction = {
    id: "workbench.extensions.action.installedExtensions",
    title: "Extensions: Show Installed Extensions",
    shortTitle: "Installed",
    menus: [{ menuId: ExtensionsFilterSubMenu, group: "3_installed", order: 1 }],
    run(accessor) {
        openExtensionsSearch(accessor, "@installed ");
    },
};

export const showExtensionUpdatesAction: CommandAction = {
    id: "workbench.extensions.action.extensionUpdates",
    title: "Extensions: Show Extension Updates",
    shortTitle: "Updates",
    menus: [{ menuId: ExtensionsFilterSubMenu, group: "3_installed", order: 2 }],
    run(accessor) {
        openExtensionsSearch(accessor, "@updates");
    },
};

/** Upstream `extensions.actions.searchByCategory.<category>`: only in the submenu, not in the palette. */
export const SEARCH_BY_CATEGORY_ACTIONS: readonly CommandAction[] = EXTENSION_CATEGORIES.map((category, index) => ({
    id: `extensions.actions.searchByCategory.${category}`,
    title: category,
    menus: [{ menuId: ExtensionsCategoryFilterSubMenu, order: index }, HIDDEN_FROM_PALETTE],
    run(accessor) {
        openExtensionsSearch(accessor, `@category:"${category.toLowerCase()}"`);
    },
}));

const SORTS: readonly { readonly id: ExtensionSortBy; readonly title: string }[] = [
    { id: "name", title: "Name" },
    { id: "publishedDate", title: "Published Date" },
];

/** Upstream `extensions.sort.<id>`: keeps the query, replaces its `@sort:`. */
export const SORT_ACTIONS: readonly CommandAction[] = SORTS.map(({ id, title }, index) => ({
    id: `extensions.sort.${id}`,
    title,
    menus: [{ menuId: ExtensionsSortSubMenu, order: index }, HIDDEN_FROM_PALETTE],
    run(accessor) {
        const query = accessor.get(ExtensionsComponentDIToken).getQuery();
        openExtensionsSearch(accessor, withSortBy(query, id));
    },
}));

export const EXTENSION_FILTER_ACTIONS: readonly CommandAction[] = [
    showInstalledExtensionsAction,
    showExtensionUpdatesAction,
    ...SEARCH_BY_CATEGORY_ACTIONS,
    ...SORT_ACTIONS,
];
