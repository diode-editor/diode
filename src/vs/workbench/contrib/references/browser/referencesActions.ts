import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { viewMenuVisible } from "../../../browser/actions/menuContexts.ts";
import { SidebarServiceDIToken } from "../../../browser/parts/sidebar/sidebarService.ts";

import { REFERENCES_VIEW_ID, REFERENCES_VIEWLET_ID, ReferencesComponentDIToken } from "./referencesComponent.ts";
import { ReferencesServiceDIToken } from "./referencesService.ts";

/** nf-cod-collapse_all */
const COLLAPSE_ALL_ICON = "\ueac5";
/** nf-cod-expand_all */
const EXPAND_ALL_ICON = "\ueb95";
/** nf-cod-clear_all */
const CLEAR_ALL_ICON = "\ueabf";

/**
 * Id команды — от VS Code references-view (Shift+Alt+F12). Leader-аккорд рядом: F-клавиши с
 * модификаторами на legacy-терминале доезжают не везде, и фича осталась бы только в палитре.
 */
export const findAllReferencesAction: CommandAction = {
    id: "references-view.findReferences",
    title: "Find All References",
    shortTitle: "Find All References",
    when: "textInputFocus",
    keybinding: parseChord("ctrl+k ctrl+r"),
    keybindings: [parseKeybinding("shift+alt+f12")],
    // Группа и порядок — дословно upstream (`goToCommands.ts`, пункт «Go to
    // References»): без reference-провайдера пункта нет.
    menus: [{ menuId: MenuId.EditorContext, group: "navigation", order: 1.45, when: "editorHasReferenceProvider" }],
    run(accessor) {
        return accessor.get(ReferencesServiceDIToken).findReferences();
    },
};

/** Отступление от VS Code, вынужденное отсутствием activity bar: без команды к панели не вернуться. */
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

/** VS Code: references-view.next / .prev. Работают и при скрытой панели. */
export const nextReferenceAction: CommandAction = {
    id: "references-view.next",
    title: "References: Go to Next Reference",
    shortTitle: "Next Reference",
    when: "hasReferenceResult",
    keybinding: parseKeybinding("f4"),
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

/** Пара в одном слоте заголовка, сменяются по `referencesViewHasSomeCollapsibleResult`, как в поиске. */
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
