import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { ContextKeyServiceDIToken } from "../../../platform/contextkey/common/contextKeyService.ts";
import type { ServiceAccessor } from "../../../platform/instantiation/common/diContainer.ts";
import type { QuickPickItem } from "../../common/quickPickItem.ts";
import { NotificationServiceDIToken } from "../../services/notification/browser/notificationService.ts";
import { AuxiliaryBarServiceDIToken } from "../parts/auxiliarybar/auxiliaryBarService.ts";
import { PanelServiceDIToken } from "../parts/panel/panelService.ts";
import { QuickInputServiceDIToken } from "../parts/quickinput/quickInputService.ts";
import type { IViewContainerSnapshot, ViewContainerLocation } from "../parts/views/viewsService.ts";
import { ViewsServiceDIToken } from "../parts/views/viewsService.ts";

// Upstream commands (`layoutActions.ts`, `panelActions.ts`) with the same ids and titles.
// Deviation: our pick has no separators — their label sits on the right of each item.

const LOCATION_GROUP_LABELS: Readonly<Record<ViewContainerLocation, string>> = {
    sidebar: "Side Bar",
    panel: "Panel",
    auxiliarybar: "Secondary Side Bar",
};

const LOCATION_ORDER: readonly ViewContainerLocation[] = ["sidebar", "panel", "auxiliarybar"];

const NEW_ENTRY_ITEMS: readonly { readonly location: ViewContainerLocation; readonly label: string }[] = [
    { location: "panel", label: "New Panel Entry" },
    { location: "sidebar", label: "New Side Bar Entry" },
    { location: "auxiliarybar", label: "New Secondary Side Bar Entry" },
];

const NO_FOCUSED_VIEW = "There is no view currently focused.";
const NOT_MOVABLE_VIEW = "The currently focused view is not movable.";

/** Like upstream's `dialogService.error`. */
function showError(accessor: ServiceAccessor, message: string): void {
    accessor.get(NotificationServiceDIToken).show({ severity: "error", message, modal: true, items: [] });
}

/** As it was when the command started. */
function focusedViewId(accessor: ServiceAccessor): string {
    return accessor.get(ContextKeyServiceDIToken).get("focusedView") ?? "";
}

interface IPick extends QuickPickItem {
    readonly run?: () => void;
}

/** Upstream's `MoveFocusedViewAction.run`. */
async function pickDestinationAndMove(accessor: ServiceAccessor, viewId: string): Promise<void> {
    const views = accessor.get(ViewsServiceDIToken);
    if (viewId.trim() === "") {
        showError(accessor, NO_FOCUSED_VIEW);
        return;
    }
    const containers = views.getViewContainers();
    const currentContainer = views.getViewContainerByViewId(viewId);
    const current = containers.find((container) => container.id === currentContainer);
    // A view whose container is not built (never attached) has no place to move from either.
    if (!views.canMoveView(viewId) || current === undefined) {
        showError(accessor, NOT_MOVABLE_VIEW);
        return;
    }
    // A hidden section is absent from the snapshot — then its id goes into the title.
    const title = current.views.find((view) => view.id === viewId)?.title ?? viewId;
    const solo = views.getContainerViews(current.id).length === 1;
    const items: IPick[] = [];
    for (const entry of NEW_ENTRY_ITEMS) {
        if (solo && current.location === entry.location) continue;
        items.push({
            label: entry.label,
            run: () => {
                views.moveViewToLocation(viewId, entry.location);
            },
        });
    }
    for (const location of LOCATION_ORDER) {
        for (const container of containers) {
            if (container.location !== location || container.id === current.id || container.rejectAddedViews) {
                continue;
            }
            items.push({
                label: container.title,
                description: LOCATION_GROUP_LABELS[location],
                run: () => {
                    views.moveViewsToContainer([viewId], container.id);
                },
            });
        }
    }
    const picked = (await accessor.get(QuickInputServiceDIToken).quickPick({
        title: `View: Move ${title}`,
        placeholder: "Select a Destination for the View",
        items,
    })) as IPick | undefined;
    if (picked?.run === undefined) return;
    picked.run();
    views.openView(viewId, true);
}

function viewItems(containers: readonly IViewContainerSnapshot[], canMove: (viewId: string) => boolean): IPick[] {
    const items: (IPick & { readonly viewId: string })[] = [];
    for (const location of LOCATION_ORDER) {
        for (const container of containers) {
            if (container.location !== location) continue;
            for (const view of container.views) {
                if (!canMove(view.id)) continue;
                items.push({
                    label: view.title,
                    description: `${LOCATION_GROUP_LABELS[location]} / ${container.title}`,
                    viewId: view.id,
                });
            }
        }
    }
    return items;
}

export const moveViewAction: CommandAction = {
    id: "workbench.action.moveView",
    title: "View: Move View",
    async run(accessor) {
        const views = accessor.get(ViewsServiceDIToken);
        const focused = focusedViewId(accessor);
        const items = viewItems(views.getViewContainers(), (id) => views.canMoveView(id));
        const activeIndex = Math.max(
            0,
            items.findIndex((item) => (item as { viewId?: string }).viewId === focused),
        );
        const picked = (await accessor.get(QuickInputServiceDIToken).quickPick({
            placeholder: "Select a View to Move",
            items,
            activeIndex,
        })) as { viewId?: string } | undefined;
        if (picked?.viewId === undefined) return;
        await pickDestinationAndMove(accessor, picked.viewId);
    },
};

export const moveFocusedViewAction: CommandAction = {
    id: "workbench.action.moveFocusedView",
    title: "View: Move Focused View",
    enablement: "focusedView != ''",
    async run(accessor) {
        await pickDestinationAndMove(accessor, focusedViewId(accessor));
    },
};

export const resetViewLocationsAction: CommandAction = {
    id: "workbench.action.resetViewLocations",
    title: "View: Reset View Locations",
    run(accessor) {
        accessor.get(ViewsServiceDIToken).resetViewLocations();
    },
};

export const resetFocusedViewLocationAction: CommandAction = {
    id: "workbench.action.resetFocusedViewLocation",
    title: "View: Reset Focused View Location",
    enablement: "focusedView != ''",
    run(accessor) {
        const viewId = focusedViewId(accessor);
        const views = accessor.get(ViewsServiceDIToken);
        // An empty or whitespace id also means "no view".
        if (views.getViewContainerByViewId(viewId) === null) {
            showError(accessor, NO_FOCUSED_VIEW);
            return;
        }
        if (views.getDefaultContainerById(viewId) === views.getViewContainerByViewId(viewId)) return;
        views.resetViewLocation(viewId);
        views.openView(viewId, true);
    },
};

/**
 * Upstream's `MoveViewsBetweenPanelsAction`: if the destination was empty, the
 * source's previously active container opens in it.
 */
function moveViewsBetweenParts(
    accessor: ServiceAccessor,
    source: "panel" | "auxiliarybar",
    destination: "panel" | "auxiliarybar",
): void {
    const views = accessor.get(ViewsServiceDIToken);
    const containers = views.getViewContainers();
    const sourceContainers = containers.filter((container) => container.location === source);
    if (sourceContainers.length === 0) return;
    const destinationWasEmpty = containers.every((container) => container.location !== destination);
    const parts = { panel: accessor.get(PanelServiceDIToken), auxiliarybar: accessor.get(AuxiliaryBarServiceDIToken) };
    const active = parts[source].getActiveViewId();
    for (const container of sourceContainers) views.moveViewContainerToLocation(container.id, destination);
    parts[destination].setVisible(true);
    // Stryker disable next-line ConditionalExpression: a non-empty source part always has an active tab — `active !== null` guards only the type; the whole condition is covered by the "into a non-empty part" test
    if (active !== null && destinationWasEmpty) views.openViewContainer(active, true);
}

export const movePanelToSecondarySideBarAction: CommandAction = {
    id: "workbench.action.movePanelToSecondarySideBar",
    title: "View: Move Panel Views To Secondary Side Bar",
    run(accessor) {
        moveViewsBetweenParts(accessor, "panel", "auxiliarybar");
    },
};

export const moveSecondarySideBarToPanelAction: CommandAction = {
    id: "workbench.action.moveSecondarySideBarToPanel",
    title: "View: Move Secondary Side Bar Views To Panel",
    run(accessor) {
        moveViewsBetweenParts(accessor, "auxiliarybar", "panel");
    },
};

export const VIEW_LOCATION_ACTIONS: readonly CommandAction[] = [
    moveViewAction,
    moveFocusedViewAction,
    resetViewLocationsAction,
    resetFocusedViewLocationAction,
    movePanelToSecondarySideBarAction,
    moveSecondarySideBarToPanelAction,
];
