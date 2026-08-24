import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import { EditorServiceDIToken } from "../../services/editor/browser/editorService.ts";

import { closeTabsWithConfirm } from "./editorCloseHelpers.ts";
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
        const target = resolveTabTarget(service, args);
        if (target === null) return;
        // С хвоста: диалоги по несохранённым идут справа налево, как у Ctrl+K W.
        const indices = target.group
            .getPanes()
            .map((_pane, index) => index)
            .filter((index) => index !== target.index)
            .reverse();
        void closeTabsWithConfirm(accessor, service, target.group, indices);
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
        const target = resolveTabTarget(service, args);
        if (target === null) return;
        const indices = target.group
            .getPanes()
            .map((_pane, index) => index)
            .filter((index) => index > target.index)
            .reverse();
        void closeTabsWithConfirm(accessor, service, target.group, indices);
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
        const target = resolveTabTarget(service, args);
        if (target === null) return;
        // Ни одного диалога по построению: закрываем ровно то, что не изменено.
        // Отсюда же ненаблюдаемость двух хвостовых шагов, и мутанта в них не убить:
        // серия не прерывается на полпути, панели резолвятся до закрытий, а индекс
        // ищется заново перед каждым, — так что от порядка набор закрытых вкладок не
        // зависит. Отрицательные индексы дошли бы до getPane(-1), то есть до null,
        // и отсеялись бы там же.
        // Stryker disable next-line MethodExpression: см. выше
        const indices = target.group
            .getPanes()
            .map((pane, index) => (pane.isModified ? -1 : index))
            .filter((index) => index >= 0)
            .reverse();
        void closeTabsWithConfirm(accessor, service, target.group, indices);
    },
};

export const TAB_CLOSE_ACTIONS: readonly CommandAction[] = [
    closeOtherEditorsAction,
    closeEditorsToTheRightAction,
    closeUnmodifiedEditorsAction,
];
