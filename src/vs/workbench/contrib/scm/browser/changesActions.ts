import { Uri } from "../../../../base/common/uri.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { scmSingleResource, scmSingleUriArg, viewMenuVisible } from "../../../browser/actions/menuContexts.ts";
import { SidebarServiceDIToken } from "../../../browser/parts/sidebar/sidebarService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { SCM_CHANGES_VIEW_ID, SCM_VIEWLET_ID } from "../common/scmViews.ts";

import { ChangesComponentDIToken } from "./changesComponent.ts";
import { openDiffWithHead } from "./compareWithHeadAction.ts";
import { ScmInputComponentDIToken } from "./scmInputComponent.ts";

export const showScmAction: CommandAction = {
    id: "workbench.view.scm",
    title: "View: Show Source Control",
    shortTitle: "Source Control",
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "3_views", order: 15 }],
    // Same as Search: the chord works on any terminal; the canonical Ctrl+Shift+G
    // is declared where the terminal can deliver it.
    keybinding: parseChord("ctrl+k g"),
    keybindings: [{ keys: parseKeybinding("ctrl+shift+g"), when: "tier != 'legacy'" }],
    run(accessor) {
        accessor.get(SidebarServiceDIToken).showViewlet(SCM_VIEWLET_ID);
    },
};

/** `workbench.view.scm` still focuses the changes list (e2e invariant). */
export const scmFocusInputAction: CommandAction = {
    id: "workbench.scm.focus",
    title: "Source Control: Focus on Source Control View",
    run(accessor) {
        accessor.get(SidebarServiceDIToken).showViewlet(SCM_VIEWLET_ID, false);
        accessor.get(ScmInputComponentDIToken).focus();
    },
};

/** InputElement does not handle ArrowDown, so the event reaches the keybinding dispatcher. */
export const scmFocusChangesAction: CommandAction = {
    id: "scm.action.focusChanges",
    title: "Source Control: Focus Changes List",
    keybinding: parseKeybinding("down"),
    when: "scmInputFocus",
    run(accessor) {
        accessor.get(ChangesComponentDIToken).focus();
    },
};

function resolveScmUri(accessor: ServiceAccessor, rawUri: unknown): Uri | null {
    if (typeof rawUri === "string" && rawUri !== "") return Uri.parse(rawUri);
    return accessor.get(ChangesComponentDIToken).getCursorChange()?.uri ?? null;
}

export const scmOpenFileAction: CommandAction = {
    id: "scm.action.openFile",
    title: "Source Control: Open File",
    shortTitle: "Open File",
    when: "scmViewletVisible",
    menus: [
        {
            menuId: MenuId.ScmContext,
            group: "1_open",
            order: 10,
            args: scmSingleUriArg,
            visible: scmSingleResource,
        },
    ],
    run(accessor, rawUri) {
        const uri = resolveScmUri(accessor, rawUri);
        return uri ? accessor.get(EditorServiceDIToken).openUri(uri) : undefined;
    },
};

/**
 * A file with no git version falls back to opening the file itself: its content is "all
 * new", and the notice is left to the palette.
 */
export const scmOpenChangesAction: CommandAction = {
    id: "scm.action.openChanges",
    title: "Source Control: Open Changes",
    shortTitle: "Open Changes",
    when: "scmViewletVisible",
    menus: [
        {
            menuId: MenuId.ScmContext,
            group: "1_open",
            order: 20,
            args: scmSingleUriArg,
            visible: scmSingleResource,
        },
    ],
    run(accessor, rawUri) {
        const uri = resolveScmUri(accessor, rawUri);
        if (!uri) return;
        return openDiffWithHead(accessor, uri).then(async (result) => {
            if (result === "no-original") await accessor.get(EditorServiceDIToken).openUri(uri);
        });
    },
};

/** A pair of commands instead of a toggle, as in search and VS Code. */
export const scmViewAsTreeAction: CommandAction = {
    id: "scm.action.viewAsTree",
    title: "Source Control: View as Tree",
    shortTitle: "View as Tree",
    when: "scmViewletVisible",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "1_view",
            order: 10,
            visible: viewMenuVisible(SCM_CHANGES_VIEW_ID),
        },
    ],
    run(accessor) {
        accessor.get(ChangesComponentDIToken).setViewMode("tree");
    },
};

export const scmViewAsListAction: CommandAction = {
    id: "scm.action.viewAsList",
    title: "Source Control: View as List",
    shortTitle: "View as List",
    when: "scmViewletVisible",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "1_view",
            order: 20,
            visible: viewMenuVisible(SCM_CHANGES_VIEW_ID),
        },
    ],
    run(accessor) {
        accessor.get(ChangesComponentDIToken).setViewMode("flat");
    },
};
