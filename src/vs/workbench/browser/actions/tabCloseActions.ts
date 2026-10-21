import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import { EditorGroupsServiceDIToken } from "../../services/editor/common/editorGroupsService.ts";
import { EditorServiceDIToken } from "../../services/editor/common/editorService.ts";

import { resolveTabTarget } from "./editorTabTarget.ts";
import {
    editorTabHasOthers,
    editorTabHasSavedTabs,
    editorTabHasTabsToTheRight,
    editorTabTargetArg,
} from "./menuContexts.ts";

export const closeOtherEditorsAction: CommandAction = {
    id: "workbench.action.closeOtherEditors",
    title: "View: Close Other Editors in Group",
    shortTitle: "Close Others",
    menus: [
        {
            menuId: MenuId.EditorTitleContext,
            group: "1_close",
            order: 20,
            args: editorTabTargetArg,
            visible: editorTabHasOthers,
        },
    ],
    run(accessor, ...args) {
        const service = accessor.get(EditorServiceDIToken);
        const target = resolveTabTarget(accessor.get(EditorGroupsServiceDIToken), args);
        if (target === null) return;
        // С хвоста: диалоги по несохранённым идут справа налево, как у Ctrl+K W.
        const panes = target.group
            .getPanes()
            .filter((_pane, index) => index !== target.index)
            .reverse();
        void service.closeEditors(target.group, panes);
    },
};

export const closeEditorsToTheRightAction: CommandAction = {
    id: "workbench.action.closeEditorsToTheRight",
    title: "View: Close Editors to the Right",
    shortTitle: "Close to the Right",
    menus: [
        {
            menuId: MenuId.EditorTitleContext,
            group: "1_close",
            order: 30,
            args: editorTabTargetArg,
            visible: editorTabHasTabsToTheRight,
        },
    ],
    run(accessor, ...args) {
        const service = accessor.get(EditorServiceDIToken);
        const target = resolveTabTarget(accessor.get(EditorGroupsServiceDIToken), args);
        if (target === null) return;
        const panes = target.group
            .getPanes()
            .filter((_pane, index) => index > target.index)
            .reverse();
        void service.closeEditors(target.group, panes);
    },
};

export const closeUnmodifiedEditorsAction: CommandAction = {
    id: "workbench.action.closeUnmodifiedEditors",
    title: "View: Close Unmodified Editors in Group",
    shortTitle: "Close Saved",
    menus: [
        {
            menuId: MenuId.EditorTitleContext,
            group: "1_close",
            order: 40,
            args: editorTabTargetArg,
            visible: editorTabHasSavedTabs,
        },
    ],
    run(accessor, ...args) {
        const service = accessor.get(EditorServiceDIToken);
        const target = resolveTabTarget(accessor.get(EditorGroupsServiceDIToken), args);
        if (target === null) return;
        // Диалогов нет: закрываем ровно неизменённое, позиция ищется заново перед каждым
        // закрытием — набор закрытых вкладок от порядка не зависит.
        const unmodified = target.group.getPanes().filter((pane) => !pane.isModified);
        // Stryker disable next-line MethodExpression: см. выше
        const panes = unmodified.toReversed();
        void service.closeEditors(target.group, panes);
    },
};

export const TAB_CLOSE_ACTIONS: readonly CommandAction[] = [
    closeOtherEditorsAction,
    closeEditorsToTheRightAction,
    closeUnmodifiedEditorsAction,
];
