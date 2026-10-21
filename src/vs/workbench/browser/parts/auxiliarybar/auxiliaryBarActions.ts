import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { LayoutServiceDIToken } from "../../../services/layout/browser/layoutService.ts";
import { ViewsServiceDIToken } from "../views/viewsService.ts";

import { CLOSE_AUXILIARY_BAR_COMMAND_ID } from "./auxiliaryBarComponent.ts";
import { AuxiliaryBarServiceDIToken } from "./auxiliaryBarService.ts";

/** Как `setAuxiliaryBarHidden(false)` эталона: открывает активный (или первый) контейнер с фокусом. */
function showAndFocusAuxiliaryBar(accessor: ServiceAccessor): void {
    accessor.get(LayoutServiceDIToken).setAuxiliaryBarVisible(true);
    const activeId = accessor.get(AuxiliaryBarServiceDIToken).getActiveViewId();
    if (activeId !== null) accessor.get(ViewsServiceDIToken).focusContainer(activeId);
}

function cycleAuxiliaryBarView(accessor: ServiceAccessor, step: 1 | -1): void {
    const auxiliaryBar = accessor.get(AuxiliaryBarServiceDIToken);
    const views = auxiliaryBar.getViews();
    if (views.length === 0) return;
    const current = views.findIndex((view) => view.id === auxiliaryBar.getActiveViewId());
    const next = views[(current + step + views.length) % views.length];
    // Пользовательская активация: ленивые фичи (терминал) просыпаются, как от клика по табу.
    auxiliaryBar.activateView(next.id);
    showAndFocusAuxiliaryBar(accessor);
}

export const toggleAuxiliaryBarAction: CommandAction = {
    id: "workbench.action.toggleAuxiliaryBar",
    title: "View: Toggle Secondary Side Bar Visibility",
    shortTitle: "Toggle Secondary Side Bar",
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "3_views", order: 45 }],
    keybinding: parseKeybinding("mod+alt+b"),
    run(accessor) {
        const layout = accessor.get(LayoutServiceDIToken);
        if (layout.isAuxiliaryBarVisible()) {
            layout.setAuxiliaryBarVisible(false);
        } else {
            showAndFocusAuxiliaryBar(accessor);
        }
    },
};

/** Отдельно от toggle, как в эталоне: `enablement` гасит пункт в палитре на скрытой части. */
export const closeAuxiliaryBarAction: CommandAction = {
    id: CLOSE_AUXILIARY_BAR_COMMAND_ID,
    title: "View: Hide Secondary Side Bar",
    enablement: "auxiliaryBarVisible",
    run(accessor) {
        accessor.get(LayoutServiceDIToken).setAuxiliaryBarVisible(false);
    },
};

export const focusAuxiliaryBarAction: CommandAction = {
    id: "workbench.action.focusAuxiliaryBar",
    title: "View: Focus into Secondary Side Bar",
    run(accessor) {
        showAndFocusAuxiliaryBar(accessor);
    },
};

export const previousAuxiliaryBarViewAction: CommandAction = {
    id: "workbench.action.previousAuxiliaryBarView",
    title: "View: Previous Secondary Side Bar View",
    run(accessor) {
        cycleAuxiliaryBarView(accessor, -1);
    },
};

export const nextAuxiliaryBarViewAction: CommandAction = {
    id: "workbench.action.nextAuxiliaryBarView",
    title: "View: Next Secondary Side Bar View",
    run(accessor) {
        cycleAuxiliaryBarView(accessor, 1);
    },
};

export const AUXILIARY_BAR_ACTIONS: readonly CommandAction[] = [
    toggleAuxiliaryBarAction,
    closeAuxiliaryBarAction,
    focusAuxiliaryBarAction,
    previousAuxiliaryBarViewAction,
    nextAuxiliaryBarViewAction,
];
