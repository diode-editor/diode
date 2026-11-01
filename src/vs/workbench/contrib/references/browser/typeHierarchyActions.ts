import { codicon } from "../../../../base/common/codicons.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { viewMenuVisible } from "../../../browser/actions/menuContexts.ts";

import { HIERARCHY_VIEW_ID } from "./hierarchyComponent.ts";
import { TypeHierarchyComponentDIToken } from "./typeHierarchyComponent.ts";

/** Ids and titles are upstream's `references-view`; it has no key for this command either. */
export const showTypeHierarchyAction: CommandAction = {
    id: "references-view.showTypeHierarchy",
    title: "Show Type Hierarchy",
    when: "editorHasTypeHierarchyProvider",
    menus: [{ menuId: MenuId.EditorContext, group: "navigation", order: 1.47, when: "editorHasTypeHierarchyProvider" }],
    run(accessor) {
        return accessor.get(TypeHierarchyComponentDIToken).show();
    },
};

/** A pair in one title slot: the command switches away from the current direction. */
export const showSupertypesAction: CommandAction = {
    id: "references-view.showSupertypes",
    title: "Show Supertypes",
    when: "typeHierarchyVisible",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 10,
            icon: codicon("type-hierarchy-super"),
            visible: viewMenuVisible(HIERARCHY_VIEW_ID),
            // The section is shared with the call tree: the mode alone would show this over calls too.
            when: "typeHierarchyVisible && typeHierarchyMode == 'subtypes'",
        },
    ],
    run(accessor) {
        return accessor.get(TypeHierarchyComponentDIToken).setDirection("supertypes");
    },
};

export const showSubtypesAction: CommandAction = {
    id: "references-view.showSubtypes",
    title: "Show Subtypes",
    when: "typeHierarchyVisible",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 10,
            icon: codicon("type-hierarchy-sub"),
            visible: viewMenuVisible(HIERARCHY_VIEW_ID),
            when: "typeHierarchyVisible && typeHierarchyMode == 'supertypes'",
        },
    ],
    run(accessor) {
        return accessor.get(TypeHierarchyComponentDIToken).setDirection("subtypes");
    },
};

/** Upstream puts it on a row; here it clears the tree, so it lives in the title. */
export const removeTypeItemAction: CommandAction = {
    id: "references-view.removeTypeItem",
    title: "Dismiss",
    when: "typeHierarchyVisible",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 20,
            icon: codicon("close"),
            visible: viewMenuVisible(HIERARCHY_VIEW_ID),
            when: "typeHierarchyVisible",
        },
    ],
    run(accessor) {
        accessor.get(TypeHierarchyComponentDIToken).dismiss();
    },
};

export const TYPE_HIERARCHY_ACTIONS: readonly CommandAction[] = [
    showTypeHierarchyAction,
    showSupertypesAction,
    showSubtypesAction,
    removeTypeItemAction,
];
