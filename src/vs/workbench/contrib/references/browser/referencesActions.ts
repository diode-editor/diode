import { codicon } from "../../../../base/common/codicons.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";
import { viewMenuVisible } from "../../../browser/actions/menuContexts.ts";
import { SidebarServiceDIToken } from "../../../browser/parts/sidebar/sidebarService.ts";

import { REFERENCES_VIEW_ID, REFERENCES_VIEWLET_ID, ReferencesComponentDIToken } from "./referencesComponent.ts";
import { ReferencesServiceDIToken } from "./referencesService.ts";

const COLLAPSE_ALL_ICON = codicon("collapse-all");
const EXPAND_ALL_ICON = codicon("expand-all");
const CLEAR_ALL_ICON = codicon("clear-all");

/**
 * Command id is from VS Code references-view (Shift+Alt+F12). A leader chord sits next to it: F-keys with
 * modifiers don't arrive everywhere on a legacy terminal, and the feature would be left only in the palette.
 */
export const findAllReferencesAction: CommandAction = {
    id: "references-view.findReferences",
    title: "Find All References",
    shortTitle: "Find All References",
    when: "textInputFocus",
    keybinding: parseChord("ctrl+k ctrl+r"),
    keybindings: [parseKeybinding("shift+alt+f12")],
    // Group and order are verbatim upstream (`goToCommands.ts`, the "Go to
    // References" item): no reference provider, no item.
    menus: [{ menuId: MenuId.EditorContext, group: "navigation", order: 1.45, when: "editorHasReferenceProvider" }],
    run(accessor) {
        return accessor.get(ReferencesServiceDIToken).findReferences();
    },
};

/** Deviation from VS Code forced by the missing activity bar: without a command there's no way back to the panel. */
export const showReferencesAction: CommandAction = {
    id: "workbench.view.references",
    title: "View: Show References",
    shortTitle: "References",
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "3_views", order: 18 }],
    keybinding: parseChord("ctrl+k r"),
    run(accessor) {
        accessor.get(SidebarServiceDIToken).showViewlet(REFERENCES_VIEWLET_ID);
    },
};

/**
 * VS Code: references-view.next / .prev. Work with the panel hidden too. The weight is that of a built-in
 * extension: while there is a result, F4 goes here and not to the search's next result (WorkbenchContrib).
 */
export const nextReferenceAction: CommandAction = {
    id: "references-view.next",
    title: "References: Go to Next Reference",
    shortTitle: "Next Reference",
    when: "hasReferenceResult",
    keybinding: parseKeybinding("f4"),
    weight: KeybindingWeight.BuiltinExtension,
    run(accessor) {
        accessor.get(ReferencesComponentDIToken).goToNextReference();
    },
};

export const previousReferenceAction: CommandAction = {
    id: "references-view.prev",
    title: "References: Go to Previous Reference",
    shortTitle: "Previous Reference",
    when: "hasReferenceResult",
    keybinding: parseKeybinding("shift+f4"),
    weight: KeybindingWeight.BuiltinExtension,
    run(accessor) {
        accessor.get(ReferencesComponentDIToken).goToPreviousReference();
    },
};

/** VS Code: references-view.clear. */
export const clearReferencesAction: CommandAction = {
    id: "references-view.clear",
    title: "References: Clear",
    shortTitle: "Clear",
    when: "referencesViewletVisible",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 20,
            icon: CLEAR_ALL_ICON,
            visible: viewMenuVisible(REFERENCES_VIEW_ID),
            when: "hasReferenceResult",
        },
    ],
    run(accessor) {
        accessor.get(ReferencesServiceDIToken).clear();
    },
};

/** A pair in one title slot, swapped by `referencesViewHasSomeCollapsibleResult`, as in search. */
export const collapseReferencesAction: CommandAction = {
    id: "references-view.collapseAll",
    title: "References: Collapse All",
    shortTitle: "Collapse All",
    when: "referencesViewletVisible",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 10,
            icon: COLLAPSE_ALL_ICON,
            visible: viewMenuVisible(REFERENCES_VIEW_ID),
            when: "!hasReferenceResult || referencesViewHasSomeCollapsibleResult",
        },
    ],
    run(accessor) {
        accessor.get(ReferencesComponentDIToken).collapseDeepestLevel();
    },
};

export const expandReferencesAction: CommandAction = {
    id: "references-view.expandAll",
    title: "References: Expand All",
    shortTitle: "Expand All",
    when: "referencesViewletVisible",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 10,
            icon: EXPAND_ALL_ICON,
            visible: viewMenuVisible(REFERENCES_VIEW_ID),
            when: "hasReferenceResult && !referencesViewHasSomeCollapsibleResult",
        },
    ],
    run(accessor) {
        accessor.get(ReferencesComponentDIToken).expandAll();
    },
};

export const REFERENCES_ACTIONS: readonly CommandAction[] = [
    findAllReferencesAction,
    showReferencesAction,
    nextReferenceAction,
    previousReferenceAction,
    clearReferencesAction,
    collapseReferencesAction,
    expandReferencesAction,
];
