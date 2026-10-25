import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { VFlexElement, vflexFill, vflexFixed } from "@tuidom/elements/layout/vFlexElement";
import type { MenuEntry, MenuSubmenuEntry } from "@tuidom/elements/menu/popupMenuElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { generateUuid } from "../../../../base/common/uuid.ts";
import { isSubmenuContribution } from "../../../../platform/actions/common/iMenuContribution.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type {
    IMenuEntryGroup,
    IResolvedMenuItemEntry,
    ResolvedMenuEntry,
} from "../../../../platform/actions/common/menuRegistry.ts";
import { CHECKED_ICON, joinMenuGroups } from "../../../../platform/actions/common/menuRegistry.ts";
import type { MenuService } from "../../../../platform/actions/common/menuService.ts";
import { MenuServiceDIToken } from "../../../../platform/actions/common/menuService.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { ContextMenuServiceDIToken } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IStateService } from "../../../../platform/state/common/iStateService.ts";
import { StateServiceDIToken } from "../../../../platform/state/common/iStateService.ts";
import {
    type IProductIconService,
    NERD_FONT_ICONS,
    ProductIconServiceDIToken,
} from "../../../../platform/theme/common/productIconService.ts";
import type { IWorkspaceContextService } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { IWorkspaceContextServiceDIToken } from "../../../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import {
    type IViewContainerViewsState,
    SIDEBAR_VIEWS_STATE,
    VIEWS_CUSTOMIZATIONS_STATE,
} from "../../../common/stateKeys.ts";
import type { ViewContainerMenuContext, ViewMenuContext } from "../../actions/menuContexts.ts";
import type { AuxiliaryBarService } from "../auxiliarybar/auxiliaryBarService.ts";
import { AuxiliaryBarServiceDIToken } from "../auxiliarybar/auxiliaryBarService.ts";
import type { IPaneCompositeTabContextMenuRequest, PaneCompositePartService } from "../paneCompositePartService.ts";
import type { PanelService } from "../panel/panelService.ts";
import { PanelServiceDIToken } from "../panel/panelService.ts";
import type { BooleanContextKey, SidebarService } from "../sidebar/sidebarService.ts";
import { SidebarServiceDIToken } from "../sidebar/sidebarService.ts";

import { containerSwitcherEntries } from "./containerSwitcher.ts";
import type { IPaneMenuAnchor } from "./paneHeaderElement.ts";
import { PaneViewElement } from "./paneViewElement.ts";
import { inlineActions, isSelectionSubmenu, NAVIGATION_GROUP, overflowEntries, runAction } from "./titleMenuEntries.ts";
import { ViewContainerHeaderElement } from "./viewContainerHeaderElement.ts";
import type { IViewTitleAction } from "./viewTitleRowElement.ts";
import type { IViewWelcomeBlock } from "./viewWelcomeElement.ts";
import { ViewWelcomeElement } from "./viewWelcomeElement.ts";

export const ViewsServiceDIToken = token<ViewsService>("ViewsService");

const VIEWS_SUBMENU_LABEL = "Views";

/** Same strings as upstream `ViewContainerLocationToString` returns. */
export type ViewContainerLocation = "sidebar" | "panel" | "auxiliarybar";

export interface IViewContainerDescriptor {
    readonly id: string;
    /** No leading spaces (`"SOURCE CONTROL"`): the header draws the indent. */
    readonly title: string;
    /**
     * The title in its author's casing ("HashiCorp Terraform") for the container switcher; without it
     * the switcher derives one from the upper-case `title`.
     */
    readonly label?: string;
    readonly location: ViewContainerLocation;
    /** Lower comes first; containers without it go after all ordered ones. */
    readonly order?: number;
    readonly isDefault?: boolean;
    /** Only for `location: "sidebar"`; set by {@link SidebarService}. */
    readonly visibleContextKey?: BooleanContextKey;
    readonly rejectAddedViews?: boolean;
}

export interface IViewDescriptor {
    readonly id: string;
    readonly containerId: string;
    /** UPPERCASE, as in VS Code (`"CHANGES"`). */
    readonly title: string;
    /** Lower is higher up. */
    readonly order: number;
    /** `null` draws {@link placeholder}. */
    readonly body: TUIElement | null;
    /**
     * A hint string or blocks of text and buttons (like `viewsWelcome`). Drawn while
     * `body === null` or while the section is gated out by {@link requiresWorkspaceFolder}.
     */
    readonly placeholder?: string | readonly IViewWelcomeBlock[];
    /**
     * Without an open folder {@link placeholder} is drawn even if the body is built (like upstream
     * `viewsWelcome` with `when: workbenchState == empty`): Search and SCM build their body up front and,
     * without a folder, would show a working-looking UI that silently does nothing.
     */
    readonly requiresWorkspaceFolder?: boolean;
    readonly focus: () => void;
    readonly minBodyHeight?: number;
    /** `false` — the section cannot be hidden via the container's "⋯" (default `true`). */
    readonly canToggleVisibility?: boolean;
    /** Initial state only: does not override the user's saved collapsed state. */
    readonly collapsed?: boolean;
    readonly canMoveView?: boolean;
}

export interface IViewContainerSnapshot {
    readonly id: string;
    readonly title: string;
    readonly label?: string;
    readonly location: ViewContainerLocation;
    /** Visible sections in display order. */
    readonly views: readonly IViewSnapshot[];
    readonly rejectAddedViews: boolean;
}

/** Same as upstream (`viewDescriptorService.ts`). */
const GENERATED_CONTAINER_PREFIX = "workbench.views.service.";

/** Upstream labels (`paneCompositeBar.ts`). */
const MOVE_TO_LABEL = "Move To";
const RESET_LOCATION_LABEL = "Reset Location";
/** Upstream order of the "Move To" items: Sidebar, AuxiliaryBar, Panel. */
const MOVE_TARGET_ORDER: readonly ViewContainerLocation[] = ["sidebar", "auxiliarybar", "panel"];
const LOCATION_MOVE_LABELS: Readonly<Record<ViewContainerLocation, string>> = {
    sidebar: "Primary Side Bar",
    auxiliarybar: "Secondary Side Bar",
    panel: "Panel",
};

const LOCATIONS: readonly ViewContainerLocation[] = ["sidebar", "panel", "auxiliarybar"];

function isViewContainerLocation(value: unknown): value is ViewContainerLocation {
    return LOCATIONS.includes(value as ViewContainerLocation);
}

function isInOverlay(element: TUIElement): boolean {
    // Find the root via the ancestor path, not getRoot(): the overlay layer has its own root.
    const path = element.getAncestorPath();
    const body = path.find((node) => node instanceof BodyElement);
    return body !== undefined && path.includes(body.getOverlayLayer());
}

/** The location is encoded in a generated container's id; `null` for other containers. */
function generatedContainerLocation(containerId: string): ViewContainerLocation | null {
    if (!containerId.startsWith(GENERATED_CONTAINER_PREFIX)) return null;
    const location = containerId.slice(GENERATED_CONTAINER_PREFIX.length).split(".")[0];
    return isViewContainerLocation(location) ? location : null;
}

export interface IViewSnapshot {
    readonly id: string;
    readonly title: string;
    readonly visible: boolean;
    readonly canToggleVisibility: boolean;
}

/** Mutable registry record: the body and title widget outlive the descriptor. */
interface ViewRecord {
    readonly id: string;
    /** Container the view is in now (moves change it). */
    containerId: string;
    readonly defaultContainerId: string;
    readonly canMoveView: boolean;
    /** The descriptor's title, which {@link ViewsService.setViewTitle} with `undefined` returns to. */
    readonly defaultTitle: string;
    /** The owner's name for the section (an extension's `TreeView.title`); `undefined` — the descriptor's. */
    titleOverride: string | undefined;
    title: string;
    description: string | null;
    readonly order: number;
    readonly focus: () => void;
    readonly minBodyHeight: number | undefined;
    readonly placeholder: string | readonly IViewWelcomeBlock[] | undefined;
    readonly requiresWorkspaceFolder: boolean;
    readonly canToggleVisibility: boolean;
    readonly collapsed: boolean;
    body: TUIElement | null;
    titleWidget: TUIElement | null;
    /** Kept in the record so it survives section rebuilds. */
    spinner: string | null;
    placeholderView: TUIElement | null;
}

interface IDetachedViewState {
    body: TUIElement | null;
    title: string | undefined;
    description: string | null;
}

interface ContainerEntry {
    /** null — the container is not registered yet (views were only added to it). */
    descriptor: IViewContainerDescriptor | null;
    location: ViewContainerLocation;
    /**
     * The container was asked to be shown: it stays in its part while it has at least one
     * view, and returns there when a view comes back to it.
     */
    wanted: boolean;
    /** Container created by moving a view (`workbench.views.service.<location>.<uuid>`). */
    generated: boolean;
    readonly views: ViewRecord[];
    readonly hidden: Set<string>;
    paneView: PaneViewElement | null;
    header: ViewContainerHeaderElement | null;
    /**
     * Sidebar "header + sections". Stable: merged mode changes the SET of children, otherwise the
     * location would hold a stale root. The panel has no stack — the header lives in the tab bar.
     */
    stack: VFlexElement | null;
    /** What the location holds (the stack in the sidebar, the PaneView itself in the panel); null — not attached. */
    view: TUIElement | null;
    /** Title buttons were not recomputed while the container was hidden; showing it catches up. */
    titleActionsStale: boolean;
}

/**
 * After {@link ViewsService.attachContainer} the descriptor, PaneView and header appear
 * TOGETHER and never go away.
 */
type AttachedEntry = ContainerEntry & {
    descriptor: IViewContainerDescriptor;
    paneView: PaneViewElement;
    header: ViewContainerHeaderElement;
};

/** Registered, but possibly not built yet. */
type AttachedEntryDescriptor = ContainerEntry & { descriptor: IViewContainerDescriptor };

function attached(entry: ContainerEntry): AttachedEntry {
    return entry as AttachedEntry;
}

function orderOf(descriptor: IViewContainerDescriptor): number {
    return descriptor.order ?? Number.POSITIVE_INFINITY;
}

/** A container away from its default location goes last (as upstream); at home it goes by `order`. */
function placementOrder(entry: AttachedEntryDescriptor): number {
    return entry.location === entry.descriptor.location ? orderOf(entry.descriptor) : Number.POSITIVE_INFINITY;
}

export interface IViewExpandedChangeEvent {
    readonly viewId: string;
    readonly expanded: boolean;
}

/**
 * Registry of view sections and container builder (lite `IViewsService`/`ViewContainerRegistry`).
 * Merged mode is derived, not declared: a container with exactly one VISIBLE view is drawn
 * without a frame, and that view's header carries the container title and does not collapse.
 */
export class ViewsService implements IContextKeyContributor {
    public static dependencies = [
        SidebarServiceDIToken,
        PanelServiceDIToken,
        ContextMenuServiceDIToken,
        MenuServiceDIToken,
        StateServiceDIToken,
        IWorkspaceContextServiceDIToken,
        CommandRegistryDIToken,
        AuxiliaryBarServiceDIToken,
        ProductIconServiceDIToken,
    ] as const;

    private readonly containers = new Map<string, ContainerEntry>();
    /** Baseline for the {@link syncExpanded} diff; a missing key means `false`. */
    private readonly expandedState = new Map<string, boolean>();
    private readonly onDidChangeViewExpandedEmitter = new Emitter<IViewExpandedChangeEvent>();
    private readonly onDidChangeLocationsEmitter = new Emitter<void>();
    private readonly onDidActivateViewEmitter = new Emitter<string>();
    private readonly onDidShowViewEmitter = new Emitter<string>();
    /**
     * What the owner gave a view that is not registered right now (an extension view whose `when` is
     * false, or one its tree arrived for first): it returns with the view.
     */
    private readonly detached = new Map<string, IDetachedViewState>();
    /** Stored moves are applied (from then on, late views place themselves by them). */
    private customizationsApplied = false;
    /** Restoring or resetting moves: the store is not written, this is not a user action. */
    private applyingCustomizations = false;

    public constructor(
        private readonly sidebarService: SidebarService,
        private readonly panelService: PanelService,
        private readonly contextMenuService: ContextMenuService,
        private readonly menuService: MenuService,
        private readonly stateService: IStateService,
        private readonly workspaceContext: IWorkspaceContextService,
        private readonly commands: CommandRegistry,
        private readonly auxiliaryBarService: AuxiliaryBarService,
        private readonly icons: IProductIconService = NERD_FONT_ICONS,
    ) {
        // Chevrons are drawn by the headers; inline button glyphs come with the next title actions resolve.
        icons.onDidChange(() => {
            for (const entry of this.containers.values()) {
                entry.paneView?.setNerdFont(icons.nerdFont);
                entry.header?.setNerdFont(icons.nerdFont);
            }
            this.refreshTitleActions();
        });
        // The service is a per-window singleton: there is nobody to dispose the subscription.
        workspaceContext.onDidChangeWorkspaceFolders(() => {
            this.refreshWorkspaceGatedViews();
        });
        // At bootstrap mount() applies the state while building containers; this handles Open Folder
        // on an already built sidebar.
        stateService.onDidOpenWorkspace(() => {
            // Locations first, then section state.
            this.reapplyStoredCustomizations();
            this.restoreViewsState();
        });
        sidebarService.onDidChangeActiveViewlet((id) => {
            this.refreshStaleTitleActions(id);
            this.fireContainerEvent(id, this.onDidShowViewEmitter);
        });
        for (const part of [panelService, auxiliaryBarService]) {
            part.onDidChangeActiveView((id) => {
                this.refreshStaleTitleActions(id);
                this.fireContainerEvent(id, this.onDidShowViewEmitter);
            });
            part.onDidActivateView((id) => {
                this.fireContainerEvent(id, this.onDidActivateViewEmitter);
            });
        }
        panelService.onDidRequestTabContextMenu((request) => {
            this.showTabContextMenu(request);
        });
        auxiliaryBarService.onDidRequestTabContextMenu((request) => {
            this.showTabContextMenu(request);
        });
    }

    public registerContainer(descriptor: IViewContainerDescriptor): void {
        const entry = this.ensureEntry(descriptor.id);
        entry.descriptor = descriptor;
        entry.location = descriptor.location;
    }

    /**
     * Any order: DI creates components before the workbench registers containers.
     * Re-registering an id replaces the record; a late registration rebuilds the sections.
     */
    public registerView(descriptor: IViewDescriptor): void {
        // Re-registration replaces the record where the view is now, so the user's move
        // survives it.
        const previous = this.findRecord(descriptor.id);
        const entry = previous?.entry ?? this.ensureEntry(descriptor.containerId);
        const existing = entry.views.findIndex((v) => v.id === descriptor.id);
        if (existing >= 0) {
            entry.views.splice(existing, 1);
        }
        const detached = this.detached.get(descriptor.id);
        entry.views.push({
            id: descriptor.id,
            containerId: previous?.record.containerId ?? descriptor.containerId,
            defaultContainerId: descriptor.containerId,
            canMoveView: descriptor.canMoveView ?? false,
            defaultTitle: descriptor.title,
            titleOverride: detached?.title,
            title: detached?.title ?? descriptor.title,
            description: detached?.description ?? null,
            order: descriptor.order,
            focus: descriptor.focus,
            minBodyHeight: descriptor.minBodyHeight,
            placeholder: descriptor.placeholder,
            requiresWorkspaceFolder: descriptor.requiresWorkspaceFolder ?? false,
            canToggleVisibility: descriptor.canToggleVisibility ?? true,
            collapsed: descriptor.collapsed ?? false,
            body: descriptor.body ?? detached?.body ?? null,
            titleWidget: null,
            spinner: null,
            placeholderView: null,
        });
        entry.views.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
        // A view registered after moves are restored goes where it was moved last time.
        // Stryker disable next-line ConditionalExpression,LogicalOperator: a re-registered view or one registered before the restore would land in the same place — the moves store already matches the current location, and the restore places early views itself
        if (previous === undefined && this.customizationsApplied) {
            const target: unknown = this.stateService.get(VIEWS_CUSTOMIZATIONS_STATE).viewLocations[descriptor.id];
            if (typeof target === "string") this.placeStoredView(descriptor.id, target);
        }
        // The view may have moved away; then syncing its default container releases it.
        this.syncPresence(entry);
    }

    /**
     * The view leaves wherever it is now (an extension view whose `when` turned false); an emptied
     * container leaves its location. Its stored state stays, so registering it again restores it.
     */
    public unregisterView(viewId: string): void {
        const found = this.findRecord(viewId);
        if (found === undefined) return;
        const { record } = found;
        this.detached.set(viewId, { body: record.body, title: record.titleOverride, description: record.description });
        this.removeRecord(found);
        this.syncPresence(found.entry);
        // A view that is gone is not expanded: registered again, it reports expanding once more.
        if (this.expandedState.get(viewId) === true) {
            this.expandedState.delete(viewId);
            this.onDidChangeViewExpandedEmitter.fire({ viewId, expanded: false });
        }
    }

    /**
     * `null` returns to the empty state; collapsed state and weight are kept. A view that is not
     * registered gets the body when it is.
     */
    public setViewBody(viewId: string, body: TUIElement | null): void {
        const found = this.findRecord(viewId);
        if (found === undefined) {
            this.detachedState(viewId).body = body;
            return;
        }
        const { entry, record } = found;
        if (record.body === body) return;
        record.body = body;
        if (entry.paneView === null || entry.hidden.has(viewId)) return;
        entry.paneView.setPaneBody(viewId, this.bodyOf(record));
    }

    /**
     * Upstream `TreeView.title`/`description`: `title` replaces the section name (`undefined` returns the
     * registered one), `description` is dimmed next to it. A view that is not registered gets them when it is.
     */
    public setViewTitle(viewId: string, title: string | undefined, description: string | null): void {
        const found = this.findRecord(viewId);
        if (found === undefined) {
            const state = this.detachedState(viewId);
            state.title = title;
            state.description = description;
            return;
        }
        const { entry, record } = found;
        const nextTitle = title ?? record.defaultTitle;
        if (record.title === nextTitle && record.description === description) return;
        record.titleOverride = title;
        record.title = nextTitle;
        record.description = description;
        if (entry.paneView === null || entry.hidden.has(viewId)) return;
        this.rebuildPanes(entry);
    }

    private detachedState(viewId: string): IDetachedViewState {
        let state = this.detached.get(viewId);
        if (state === undefined) {
            // Stryker disable next-line ObjectLiteral: equivalent — registerView falls back to the same defaults for every missing field
            state = { body: null, title: undefined, description: null };
            this.detached.set(viewId, state);
        }
        return state;
    }

    /** Escape hatch for controls that cannot be a menu item (Output channels). */
    public setViewTitleWidget(viewId: string, widget: TUIElement | null): void {
        const { entry, record } = this.recordOrThrow(viewId);
        if (record.titleWidget === widget) return;
        record.titleWidget = widget;
        if (entry.paneView === null || entry.hidden.has(viewId)) return;
        this.refreshContainerTitleActions(entry);
    }

    /**
     * The frame tick (10 Hz) takes this short path instead of `refreshContainerTitleActions`
     * (which resolves every section's menu). An unregistered view is a silent no-op.
     */
    public setViewSpinner(viewId: string, frame: string | null): void {
        const found = this.findRecord(viewId);
        if (found === undefined) return;
        const { entry, record } = found;
        // Only the spinner appearing or disappearing changes what the tab bar control strip contains.
        // Stryker disable next-line ConditionalExpression: the recompute is idempotent, so an extra call shows only in cost; skipping a needed one is covered by the test for the strip appearing and disappearing
        const appeared = (record.spinner === null) !== (frame === null);
        record.spinner = frame;
        if (entry.paneView === null || entry.hidden.has(viewId)) return;
        this.applySpinner(entry, record);
        // Stryker disable next-line ConditionalExpression,LogicalOperator: same reason as the line above — an extra recompute is unobservable
        if (appeared && this.isTabbed(entry)) this.refreshContainerTitleActions(entry);
    }

    public getViewTitleWidget(viewId: string): TUIElement | null {
        return this.recordOrThrow(viewId).record.titleWidget;
    }

    public getContainerViews(containerId: string): readonly IViewSnapshot[] {
        const entry = this.containerOrThrow(containerId);
        return entry.views.map((v) => ({
            id: v.id,
            title: v.title,
            visible: !entry.hidden.has(v.id),
            canToggleVisibility: v.canToggleVisibility,
        }));
    }

    public isViewVisible(viewId: string): boolean {
        const { entry } = this.recordOrThrow(viewId);
        return !entry.hidden.has(viewId);
    }

    /** The container is built and the section is neither hidden nor collapsed; a merged section is always expanded. */
    public isViewExpanded(viewId: string): boolean {
        const { entry } = this.recordOrThrow(viewId);
        if (entry.paneView === null || entry.hidden.has(viewId)) return false;
        return !entry.paneView.isCollapsed(viewId);
    }

    /**
     * The service diffs this itself rather than {@link PaneViewElement}: that one recreates panes and
     * silently ignores collapsing a merged section, so a per-pane event would lose transitions.
     */
    public readonly onDidChangeViewExpanded = this.onDidChangeViewExpandedEmitter.event;

    private syncExpanded(entry: ContainerEntry): void {
        for (const view of entry.views) {
            const expanded = this.isViewExpanded(view.id);
            if ((this.expandedState.get(view.id) ?? false) === expanded) continue;
            this.expandedState.set(view.id, expanded);
            this.onDidChangeViewExpandedEmitter.fire({ viewId: view.id, expanded });
        }
    }

    /** The last visible section cannot be hidden, as in VS Code. */
    public setViewVisible(viewId: string, visible: boolean): void {
        const { entry, record } = this.recordOrThrow(viewId);
        if (!record.canToggleVisibility) return;
        if (entry.hidden.has(viewId) === !visible) return;
        if (!visible && this.visibleViews(entry).length <= 1) return;
        if (visible) {
            entry.hidden.delete(viewId);
        } else {
            entry.hidden.add(viewId);
        }
        if (entry.paneView !== null) {
            this.rebuildPanes(entry);
            this.persistContainerState(record.containerId, entry);
        }
    }

    /**
     * The single place where containers are built. Leaves sidebar visibility alone — layout
     * persistence restores it.
     */
    public attachRegisteredContainers(): void {
        // Moves go before building, so the container is built at its location right away.
        this.applyStoredCustomizations();
        const registered = [...this.containers.values()]
            .filter((entry) => entry.descriptor !== null)
            .map((entry) => attached(entry).descriptor)
            .sort((a, b) => orderOf(a) - orderOf(b));
        for (const descriptor of registered) {
            this.attachContainer(descriptor.id);
        }
        this.showDefaultViewlet();
    }

    /**
     * `orFirst` — if the sidebar has no default container (moved away or empty), show the first one.
     * Leaves sidebar visibility alone.
     */
    private showDefaultViewlet(orFirst = false): void {
        const sidebar = [...this.containers.values()]
            .filter((entry) => entry.view !== null && entry.location === "sidebar")
            .map((entry) => attached(entry).descriptor)
            .sort((a, b) => orderOf(a) - orderOf(b));
        const fallback =
            sidebar.find((descriptor) => descriptor.isDefault === true) ?? (orFirst ? sidebar.at(0) : undefined);
        if (fallback !== undefined) {
            this.sidebarService.showViewlet(fallback.id, false);
        }
    }

    /**
     * A container without a single view takes no place (as upstream) and puts itself there
     * once a view arrives.
     */
    public attachContainer(containerId: string): void {
        const entry = this.containerOrThrow(containerId);
        if (entry.descriptor === null) {
            throw new Error(`ViewsService: container "${containerId}" is not registered`);
        }
        entry.wanted = true;
        this.syncPresence(entry);
    }

    private buildContainer(entry: AttachedEntryDescriptor): void {
        const containerId = entry.descriptor.id;
        const paneView = new PaneViewElement();
        paneView.setNerdFont(this.icons.nerdFont);
        // Dots in the container id become dashes: inspector/e2e selectors don't
        // support them (`workbench.panel.output` → `#viewContainer-workbench-panel-output`).
        const domId = containerId.replaceAll(".", "-");
        paneView.id = `viewContainer-${domId}`;
        paneView.onDidChangeState = () => {
            this.persistContainerState(containerId, entry);
            this.syncExpanded(entry);
        };
        paneView.onDidRequestPaneMenu = (paneId, anchor) => {
            this.contextMenuService.showContextMenu({
                getOwner: () => paneView,
                getAnchor: () => anchor,
                getEntries: () => this.paneMenuEntries(entry, paneId),
            });
        };
        paneView.onDidRequestSwitcher = (anchor) => {
            this.showContainerSwitcher(paneView, anchor);
        };
        paneView.onDidRequestPaneAction = (paneId, actionId) => {
            runAction(this.viewTitleGroups(paneId), actionId);
        };
        entry.paneView = paneView;
        // The panel (and the auxiliary bar) has no header row — the same header serves
        // as the control strip in the tab bar, so it carries no title.
        const tabbed = this.isTabbed(entry);
        const header = new ViewContainerHeaderElement(tabbed ? "" : containerTitle(entry));
        header.id = `viewContainerHeader-${domId}`;
        header.setNerdFont(this.icons.nerdFont);
        header.onMenu = (anchor) => {
            this.contextMenuService.showContextMenu({
                getOwner: () => header,
                getAnchor: () => anchor,
                getEntries: () => this.titleMenuEntries(entry),
            });
        };
        header.onAction = (actionId) => {
            runAction(this.titleGroups(entry), actionId);
        };
        header.setSwitcher(!tabbed);
        header.onSwitch = (anchor) => {
            this.showContainerSwitcher(header, anchor);
        };
        entry.header = header;
        if (tabbed) {
            // Compute the position BEFORE the container becomes attached:
            // it does not count itself.
            const index = this.tabIndexOf(entry);
            entry.view = paneView;
            // Add the tab BEFORE building sections: the tab bar control strip
            // is set through the part's registry, which ignores unknown ids.
            this.partOf(entry).addView({ id: containerId, title: containerTitle(entry), content: paneView, index });
            this.rebuildPanes(entry);
            // The part's first tab becomes active silently (no change event),
            // so we announce that its views are shown ourselves.
            if (this.partOf(entry).getActiveViewId() === containerId)
                this.fireContainerEvent(containerId, this.onDidShowViewEmitter);
            return;
        }
        const stack = new VFlexElement();
        // Stable location selector for e2e/inspector (`#explorer`, `#scm`).
        stack.id = domId;
        stack.style = { fg: "sideBar.foreground", bg: "sideBar.background" };
        entry.stack = stack;
        entry.view = stack;
        this.rebuildPanes(entry);
        this.sidebarService.registerViewlet(
            containerId,
            stack,
            () => {
                this.focusContainer(containerId);
            },
            entry.descriptor.visibleContextKey,
        );
    }

    /** The sidebar title's dropdown of sidebar containers ({@link containerSwitcherEntries}). */
    private showContainerSwitcher(owner: TUIElement, anchor: IPaneMenuAnchor): void {
        this.contextMenuService.showContextMenu({
            getOwner: () => owner,
            getAnchor: () => anchor,
            getEntries: () =>
                // Only sidebar containers are listed, and showing a viewlet already focuses it.
                containerSwitcherEntries(this.getViewContainers(), this.sidebarService.getActiveViewletId(), (id) => {
                    this.openViewContainer(id);
                }),
        });
    }

    private tabIndexOf(target: AttachedEntryDescriptor): number {
        let index = 0;
        for (const entry of this.containers.values()) {
            if (entry.view === null || entry.location !== target.location) continue;
            if (placementOrder(entry as AttachedEntryDescriptor) <= placementOrder(target)) index++;
        }
        return index;
    }

    /**
     * Strictly after `openWorkspace`, otherwise the empty window's store is read. No write-through.
     */
    public restoreViewsState(): void {
        for (const entry of this.containers.values()) {
            this.restoreContainerState(entry);
        }
    }

    private restoreContainerState(entry: ContainerEntry): void {
        const paneView = entry.paneView;
        const state =
            entry.descriptor === null ? undefined : this.stateService.get(SIDEBAR_VIEWS_STATE)[entry.descriptor.id];
        if (paneView === null || state === undefined) return;
        // Apply hidden state before weights: it rebuilds the sections, and
        // the only section left visible becomes merged.
        // Stryker disable next-line ArrayDeclaration: an unknown id in the hidden list is skipped below — a junk element is unobservable
        const hidden = state.hidden ?? [];
        entry.hidden.clear();
        for (const viewId of hidden) {
            const record = entry.views.find((v) => v.id === viewId);
            if (record?.canToggleVisibility === true) entry.hidden.add(viewId);
        }
        // Silently fix a stale store where everything is hidden; a built container
        // never has zero views (syncPresence detaches it).
        if (entry.hidden.size === entry.views.length) {
            entry.hidden.delete(entry.views[0].id);
        }
        this.rebuildPanes(entry);
        paneView.setWeights(state.weights);
        for (const paneId of paneView.getPaneIds()) {
            const collapsed = storedCollapsed(state.collapsed, paneId);
            // The store doesn't know this section — the descriptor default stays.
            if (collapsed !== undefined) paneView.setCollapsed(paneId, collapsed);
        }
        // The programmatic `setCollapsed` path doesn't call `onDidChangeState`,
        // so we notify subscribers about the restored collapsed state ourselves.
        this.syncExpanded(entry);
    }

    public getViewContainerLocation(containerId: string): ViewContainerLocation | null {
        const entry = this.containers.get(containerId);
        return entry?.descriptor == null ? null : entry.location;
    }

    public getDefaultViewContainerLocation(containerId: string): ViewContainerLocation | null {
        return this.containers.get(containerId)?.descriptor?.location ?? null;
    }

    public getViewContainerByViewId(viewId: string): string | null {
        return this.findRecord(viewId)?.record.containerId ?? null;
    }

    public getDefaultContainerById(viewId: string): string | null {
        return this.findRecord(viewId)?.record.defaultContainerId ?? null;
    }

    public canMoveView(viewId: string): boolean {
        return this.findRecord(viewId)?.record.canMoveView ?? false;
    }

    /** Containers in place (registered and non-empty), by location and `order`. */
    public getViewContainers(): readonly IViewContainerSnapshot[] {
        return [...this.containers.values()]
            .filter((entry): entry is AttachedEntry => entry.view !== null)
            .sort(
                (a, b) =>
                    LOCATIONS.indexOf(a.location) - LOCATIONS.indexOf(b.location) ||
                    orderOf(a.descriptor) - orderOf(b.descriptor),
            )
            .map((entry) => ({
                id: entry.descriptor.id,
                title: containerTitle(entry),
                label: entry.descriptor.label,
                location: entry.location,
                views: this.getContainerViews(entry.descriptor.id).filter((view) => view.visible),
                rejectAddedViews: entry.descriptor.rejectAddedViews === true,
            }));
    }

    /** Into a NEW container at `location`; an immovable view is a no-op. */
    public moveViewToLocation(viewId: string, location: ViewContainerLocation): void {
        // The move skips an immovable view, and the empty new container is then removed.
        const target = this.createGeneratedContainer(location);
        this.moveViewsToContainer([viewId], target.descriptor.id);
    }

    /**
     * An emptied container leaves its location, and a generated one disappears entirely.
     * Immovable views and a container that rejects foreign views are skipped.
     */
    public moveViewsToContainer(viewIds: readonly string[], containerId: string): void {
        const target = this.containers.get(containerId);
        if (target?.descriptor == null) return;
        const sources = new Set<ContainerEntry>();
        for (const viewId of viewIds) {
            const found = this.findRecord(viewId);
            if (found === undefined || !found.record.canMoveView || found.entry === target) continue;
            const ownDefault = found.record.defaultContainerId === containerId;
            if (target.descriptor.rejectAddedViews === true && !ownDefault) continue;
            this.moveRecord(found, target);
            sources.add(found.entry);
        }
        if (sources.size === 0) {
            if (target.generated && target.views.length === 0) this.containers.delete(containerId);
            return;
        }
        // Target first (its tab appears), then the sources (emptied ones leave).
        this.syncPresence(target);
        for (const source of sources) this.syncPresence(source);
        this.didChangeLocations();
    }

    public moveViewContainerToLocation(containerId: string, location: ViewContainerLocation): void {
        const entry = this.containers.get(containerId);
        if (entry?.descriptor == null || entry.location === location) return;
        this.setContainerLocation(entry, location);
        this.didChangeLocations();
    }

    public resetViewLocation(viewId: string): void {
        // A view already at home is skipped by the move into its own container.
        const found = this.findRecord(viewId);
        if (found !== undefined) this.moveViewsToContainer([viewId], found.record.defaultContainerId);
    }

    public resetViewContainerLocation(containerId: string): void {
        const location = this.getDefaultViewContainerLocation(containerId);
        // Stryker disable next-line ConditionalExpression: an unknown container has no location and the move would skip it anyway — the guard is only for the type
        if (location !== null) this.moveViewContainerToLocation(containerId, location);
    }

    public resetViewLocations(): void {
        this.resetLocations();
        this.didChangeLocations();
    }

    /** A view or container changed location (move, reset, restoring the project's moves). */
    public readonly onDidChangeLocations = this.onDidChangeLocationsEmitter.event;

    /**
     * Activates the part's tab as a user would (lazy features wake up) and shows the
     * part; a viewlet is shown in the sidebar.
     */
    public openViewContainer(containerId: string, focus = false): void {
        const entry = this.containers.get(containerId);
        if (entry?.view == null) return;
        if (this.isTabbed(entry)) {
            const part = this.partOf(entry);
            part.activateView(containerId);
            part.setVisible(true);
            if (focus) this.focusContainer(containerId);
            return;
        }
        // In the sidebar showing and focusing is a single step (`showViewlet` with reveal).
        this.sidebarService.showViewlet(containerId, true);
    }

    /**
     * Reveals a hidden section. `activate: false` is a programmatic show: lazy features (shell
     * spawn) don't wake up; used by commands that decide themselves what to create in the view.
     */
    public openView(viewId: string, focus = false, activate = true): void {
        const found = this.findRecord(viewId);
        if (found?.entry.view == null) return;
        // setViewVisible leaves an already visible section alone.
        this.setViewVisible(viewId, true);
        if (activate || !this.isTabbed(found.entry)) {
            this.openViewContainer(found.record.containerId, false);
        } else {
            const part = this.partOf(found.entry);
            part.setActiveView(found.record.containerId);
            part.setVisible(true);
        }
        // Upstream `ViewPaneContainer.openView`: the opened section is expanded, as if the user did it.
        // The container is built (checked above) and the section is shown (setViewVisible).
        const paneView = attached(found.entry).paneView;
        if (paneView.isCollapsed(viewId)) paneView.toggleCollapsed(viewId);
        if (!focus) return;
        const body = this.bodyOf(found.record);
        if (body instanceof ViewWelcomeElement && body.focusFirstButton()) return;
        found.record.focus();
    }

    /**
     * Upstream `isViewVisible`: the container is active in its part, the part is visible, the section is not hidden.
     * Our `isViewVisible` is about section hiding, hence the different name.
     */
    public isViewShown(viewId: string): boolean {
        const found = this.findRecord(viewId);
        if (found?.entry.view == null || found.entry.hidden.has(viewId)) return false;
        const containerId = found.record.containerId;
        if (!this.isTabbed(found.entry)) return this.sidebarService.isViewletVisible(containerId);
        const part = this.partOf(found.entry);
        return part.visible && part.getActiveViewId() === containerId;
    }

    /** Hides the part if the view's container is active in it; a view in the part's background leaves it alone. */
    public closeView(viewId: string): void {
        const found = this.findRecord(viewId);
        if (found?.entry.view == null) return;
        const containerId = found.record.containerId;
        if (!this.isTabbed(found.entry)) {
            this.sidebarService.hideViewlet(containerId);
            return;
        }
        const part = this.partOf(found.entry);
        if (part.getActiveViewId() === containerId) part.setVisible(false);
    }

    /** The user activated a view — lazy features (terminal shell) wake up here. */
    public readonly onDidActivateView = this.onDidActivateViewEmitter.event;

    /** A view became active in its part — by the user or programmatically (restore, move). */
    public readonly onDidShowView = this.onDidShowViewEmitter.event;

    private fireContainerEvent(containerId: string, emitter: Emitter<string>): void {
        const entry = this.containers.get(containerId);
        if (entry?.view == null) return;
        for (const record of entry.views) {
            if (!entry.hidden.has(record.id)) emitter.fire(record.id);
        }
    }

    public getFocusedViewId(active: TUIElement | null): string | null {
        if (active === null) return null;
        const path = active.getAncestorPath();
        for (const entry of this.containers.values()) {
            // Stryker disable next-line ConditionalExpression,LogicalOperator: skipping the whole container is only a speedup — a view body outside its PaneView is never on the focus path
            if (entry.paneView === null || !path.includes(entry.paneView)) continue;
            for (const record of entry.views) {
                const body = record.body ?? record.placeholderView;
                if (body !== null && path.includes(body)) return record.id;
            }
        }
        return null;
    }

    /**
     * `focusedView`. Focus in an overlay doesn't clear it: "Move Focused View" from the command palette must
     * see the view the palette was opened from (upstream runs the command with focus on the view).
     */
    public updateContextKeys(contextKeys: ContextKeyService, active: TUIElement | null): void {
        // `null` doesn't mean leaving the view either: that's what the gap between the view's
        // blur and the palette input's focus looks like.
        if (active === null || isInOverlay(active)) return;
        contextKeys.set("focusedView", this.getFocusedViewId(active) ?? "");
    }

    /**
     * Like upstream `getContextMenuActionsForComposite`: locations in the order Primary Side Bar,
     * Secondary Side Bar, Panel, minus the current one.
     */
    private locationMenuEntries(entry: ContainerEntry): MenuEntry[] {
        const descriptor = attached(entry).descriptor;
        const moves = MOVE_TARGET_ORDER.filter((location) => location !== entry.location).map(
            (location): MenuEntry => ({
                label: LOCATION_MOVE_LABELS[location],
                id: `${descriptor.id}.moveViewContainerTo.${location}`,
                onSelect: () => {
                    this.moveViewContainerToLocation(descriptor.id, location);
                    this.openViewContainer(descriptor.id, true);
                },
            }),
        );
        const entries: MenuEntry[] = [{ type: "submenu", label: MOVE_TO_LABEL, entries: moves }];
        const reset = this.resetLocationEntry(entry);
        if (reset !== null) entries.push(reset);
        return entries;
    }

    /** "Reset Location": moves a misplaced container back, or the single view of a generated one. */
    private resetLocationEntry(entry: ContainerEntry): MenuEntry | null {
        const descriptor = attached(entry).descriptor;
        if (!entry.generated && entry.location !== descriptor.location) {
            return {
                label: RESET_LOCATION_LABEL,
                id: `${descriptor.id}.resetViewContainerLocation`,
                onSelect: () => {
                    this.resetViewContainerLocation(descriptor.id);
                    this.openViewContainer(descriptor.id, true);
                },
            };
        }
        const only = entry.views.length === 1 ? entry.views[0] : undefined;
        if (only === undefined || only.defaultContainerId === descriptor.id) return null;
        return {
            label: RESET_LOCATION_LABEL,
            id: `${only.id}.resetViewLocation`,
            onSelect: () => {
                this.resetViewLocation(only.id);
                this.openView(only.id, true);
            },
        };
    }

    private showTabContextMenu(request: IPaneCompositeTabContextMenuRequest): void {
        const entry = this.containers.get(request.id);
        if (entry?.view == null) return;
        this.contextMenuService.showContextMenu({
            getOwner: () => request.owner,
            getAnchor: () => request.anchor,
            getEntries: () => this.locationMenuEntries(entry),
        });
    }

    private resetLocations(): void {
        const touched = new Set<ContainerEntry>();
        for (const entry of [...this.containers.values()]) {
            for (const record of [...entry.views]) {
                if (record.containerId === record.defaultContainerId) continue;
                const target = this.ensureEntry(record.defaultContainerId);
                this.moveRecord({ entry, record }, target);
                touched.add(entry).add(target);
            }
        }
        for (const entry of touched) this.syncPresence(entry);
        for (const entry of [...this.containers.values()]) {
            if (entry.descriptor === null || entry.generated || entry.location === entry.descriptor.location) continue;
            this.setContainerLocation(entry, entry.descriptor.location);
        }
    }

    private didChangeLocations(): void {
        this.saveCustomizations();
        this.onDidChangeLocationsEmitter.fire();
    }

    /** Moves a view record to another container ({@link syncPresence} rebuilds the locations). */
    private moveRecord(found: { entry: ContainerEntry; record: ViewRecord }, target: ContainerEntry): void {
        const { record } = found;
        this.removeRecord(found);
        record.containerId = attached(target).descriptor.id;
        target.views.push(record);
        target.views.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    }

    private removeRecord({ entry, record }: { entry: ContainerEntry; record: ViewRecord }): void {
        entry.views.splice(entry.views.indexOf(record), 1);
        entry.hidden.delete(record.id);
        // The remaining sections can't all be hidden (see setViewVisible).
        if (entry.views.length > 0 && entry.hidden.size === entry.views.length) {
            entry.hidden.delete(entry.views[0].id);
        }
    }

    private setContainerLocation(entry: ContainerEntry, location: ViewContainerLocation): void {
        // Detach from the old location while `location` is still the old one.
        if (entry.view !== null) this.detachContainer(entry);
        entry.location = location;
        this.syncPresence(entry);
    }

    private createGeneratedContainer(
        location: ViewContainerLocation,
        id = `${GENERATED_CONTAINER_PREFIX}${location}.${generateUuid()}`,
    ): AttachedEntryDescriptor {
        // Stryker disable next-line StringLiteral: a generated container's own title is never read — its first view supplies it (containerTitle)
        this.registerContainer({ id, title: "", location });
        const entry = this.containerOrThrow(id) as AttachedEntryDescriptor;
        entry.generated = true;
        entry.wanted = true;
        return entry;
    }

    /** With views — built; without views — detached; generated without views — removed. */
    private syncPresence(entry: ContainerEntry): void {
        if (entry.paneView !== null && entry.views.length > 0) {
            this.rebuildPanes(entry);
            return;
        }
        // Stryker disable next-line ConditionalExpression: `wanted` is set only by attachContainer and createGeneratedContainer, both with a descriptor; the null check is for the type
        if (entry.descriptor === null || !entry.wanted) return;
        if (entry.views.length === 0) {
            if (entry.view !== null) this.detachContainer(entry);
            if (entry.generated) this.disposeGeneratedContainer(entry.descriptor.id);
            return;
        }
        this.buildContainer(entry as AttachedEntryDescriptor);
        this.restoreContainerState(entry);
    }

    /** View bodies are detached and wait for the next build. */
    private detachContainer(entry: ContainerEntry): void {
        const id = attached(entry).descriptor.id;
        const wasActiveViewlet = !this.isTabbed(entry) && this.sidebarService.getActiveViewletId() === id;
        if (this.isTabbed(entry)) this.partOf(entry).removeView(id);
        else this.sidebarService.unregisterViewlet(id);
        const paneView = attached(entry).paneView;
        for (const paneId of [...paneView.getPaneIds()]) paneView.removePane(paneId);
        entry.paneView = null;
        entry.header = null;
        entry.stack = null;
        entry.view = null;
        this.syncExpanded(entry);
        if (wasActiveViewlet) this.showDefaultViewlet(true);
    }

    private disposeGeneratedContainer(id: string): void {
        this.containers.delete(id);
        const stored = this.stateService.get(SIDEBAR_VIEWS_STATE);
        if (stored[id] === undefined || this.applyingCustomizations) return;
        this.stateService.store(
            SIDEBAR_VIEWS_STATE,
            Object.fromEntries(Object.entries(stored).filter(([key]) => key !== id)),
        );
    }

    /** Only the differences from defaults — like upstream `saveViewCustomizations`. */
    private saveCustomizations(): void {
        // Stryker disable next-line ConditionalExpression: restoring and resetting moves don't come here (they skip didChangeLocations) — a guard against a subscriber that moves a view from onDidChangeLocations
        if (this.applyingCustomizations) return;
        const viewContainerLocations: Record<string, string> = {};
        const viewLocations: Record<string, string> = {};
        for (const [id, entry] of this.containers) {
            if (entry.descriptor !== null && (entry.generated || entry.location !== entry.descriptor.location)) {
                viewContainerLocations[id] = entry.location;
            }
            for (const record of entry.views) {
                if (record.containerId !== record.defaultContainerId) viewLocations[record.id] = record.containerId;
            }
        }
        this.stateService.store(VIEWS_CUSTOMIZATIONS_STATE, { viewContainerLocations, viewLocations });
    }

    private applyStoredCustomizations(): void {
        const stored = this.stateService.get(VIEWS_CUSTOMIZATIONS_STATE);
        // Stryker disable next-line BooleanLiteral: the restore only places views into generated containers and never empties them, so the store isn't written under the flag here; the flag is for the reset in reapplyStoredCustomizations
        this.applyingCustomizations = true;
        try {
            for (const [id, location] of Object.entries(stored.viewContainerLocations)) {
                const entry = this.containers.get(id);
                if (entry?.descriptor == null || entry.generated || !isViewContainerLocation(location)) continue;
                if (entry.location !== location) this.setContainerLocation(entry, location);
            }
            for (const [viewId, containerId] of Object.entries(stored.viewLocations) as [string, unknown][]) {
                if (typeof containerId === "string") this.placeStoredView(viewId, containerId);
            }
        } finally {
            this.applyingCustomizations = false;
        }
        this.customizationsApplied = true;
    }

    /** Creates the generated container if needed; with nowhere to place it, the view stays home. */
    private placeStoredView(viewId: string, containerId: string): void {
        const found = this.findRecord(viewId);
        if (!found?.record.canMoveView) return;
        let target = this.containers.get(containerId);
        if (target?.descriptor == null) {
            const stored = this.stateService.get(VIEWS_CUSTOMIZATIONS_STATE).viewContainerLocations[containerId];
            const location = isViewContainerLocation(stored) ? stored : generatedContainerLocation(containerId);
            if (location === null) return;
            target = this.createGeneratedContainer(location, containerId);
        }
        // Stryker disable next-line ConditionalExpression: the store holds only views outside their own container, while a new view is in its own — "→ true" would move the record to the same place
        if (found.entry !== target) {
            this.moveRecord(found, target);
            this.syncPresence(found.entry);
        }
        this.syncPresence(target);
    }

    private reapplyStoredCustomizations(): void {
        if (!this.customizationsApplied) return;
        // applyStoredCustomizations clears the flag — the reset runs under it too.
        this.applyingCustomizations = true;
        this.resetLocations();
        this.applyStoredCustomizations();
        this.onDidChangeLocationsEmitter.fire();
    }

    /** Focuses the container's first expanded visible view (reveal, show commands). */
    public focusContainer(containerId: string): void {
        const entry = this.containerOrThrow(containerId);
        const paneView = entry.paneView;
        if (paneView === null) return;
        const visible = this.visibleViews(entry);
        const target = visible.find((v) => !paneView.isCollapsed(v.id)) ?? visible.at(0);
        if (target === undefined) return;
        // If the empty state is on screen, focus goes there: the way out of "no folder opened"
        // is a single Enter on the welcome button, not Tabbing out of an invisible input.
        const body = this.bodyOf(target);
        if (body instanceof ViewWelcomeElement && body.focusFirstButton()) return;
        target.focus();
    }

    /** For a view without a body of its own (an extension view's placeholder): focus lands on its header. */
    public focusViewHeader(viewId: string): void {
        const found = this.findRecord(viewId);
        if (found?.entry.paneView == null || found.entry.hidden.has(viewId)) return;
        found.entry.paneView.focusPane(viewId);
    }

    /** Upstream's view pane binds `view = <id>` in its scoped context: extension items say `when: view == <id>`. */
    private viewTitleGroups(viewId: string): IMenuEntryGroup[] {
        const context: ViewMenuContext = { view: viewId };
        return this.menuService.getEntryGroups(MenuId.ViewTitle, context, { view: viewId });
    }

    private containerTitleGroups(containerId: string): IMenuEntryGroup[] {
        const context: ViewContainerMenuContext = { container: containerId };
        return this.menuService.getEntryGroups(MenuId.ViewContainerTitle, context);
    }

    /** The section's "⋯" popup. When merged, the container menu moves here too, as a submenu. */
    private paneMenuEntries(entry: ContainerEntry, viewId: string): MenuEntry[] {
        const entries = overflowEntries(this.viewTitleGroups(viewId));
        if (!this.isMerged(entry)) return entries;
        const container = this.containerSubmenu(entry);
        if (container === null) return entries;
        return entries.length > 0 ? [...entries, { type: "separator" }, container] : [container];
    }

    /** Only a non-merged container (2+ sections) has its own header, so the toggle is always present here. */
    private containerMenuEntries(entry: ContainerEntry): MenuEntry[] {
        const entries = overflowEntries(this.containerTitleGroups(attached(entry).descriptor.id));
        const views = this.buildViewsSubmenu(entry);
        const own: MenuEntry[] = entries.length > 0 ? [...entries, { type: "separator" }, views] : [views];
        return [...own, ...this.sidebarLocationEntries(entry)];
    }

    /**
     * Deviation: upstream puts "Move To" in the activity bar icon's context menu, which we
     * don't have. Part tabs carry it in their own menu ({@link showTabContextMenu}).
     */
    private sidebarLocationEntries(entry: ContainerEntry): MenuEntry[] {
        if (this.isTabbed(entry)) return [];
        return [{ type: "separator" }, ...this.locationMenuEntries(entry)];
    }

    /**
     * A merged container has no header of its own: its commands (including the inline group — there is
     * nowhere to draw it) and the section toggle live in the single section's "⋯".
     */
    private containerSubmenu(entry: ContainerEntry): MenuSubmenuEntry | null {
        const own = joinMenuGroups(this.containerTitleGroups(attached(entry).descriptor.id));
        const views = this.viewsSubmenu(entry);
        const commands: MenuEntry[] =
            views === null ? own : own.length > 0 ? [...own, { type: "separator" as const }, views] : [views];
        const location = this.sidebarLocationEntries(entry);
        const entries = commands.length > 0 ? [...commands, ...location] : location.slice(1);
        if (entries.length === 0) return null;
        return { type: "submenu", label: containerTitle(entry), entries };
    }

    /** The items are dynamic and absent from the menu registry — hence built here, not as a contribution. */
    private viewsSubmenu(entry: ContainerEntry): MenuSubmenuEntry | null {
        if (entry.views.length < 2) return null;
        return this.buildViewsSubmenu(entry);
    }

    /** The submenu itself, without the "2+ sections" check — for places where it is known to exist. */
    private buildViewsSubmenu(entry: ContainerEntry): MenuSubmenuEntry {
        return {
            type: "submenu",
            label: VIEWS_SUBMENU_LABEL,
            entries: entry.views.map((record) => {
                const visible = !entry.hidden.has(record.id);
                return {
                    label: record.title,
                    id: record.id,
                    icon: visible ? CHECKED_ICON : undefined,
                    onSelect: () => {
                        this.setViewVisible(record.id, !visible);
                    },
                };
            }),
        };
    }

    /**
     * In the panel a merged container's tab acts as its header, so the tab bar control strip
     * carries the actions of its ONLY section (as in VS Code).
     */
    private headerTargetView(entry: ContainerEntry): string | null {
        if (!this.isTabbed(entry) || !this.isMerged(entry)) return null;
        // Merged means exactly one visible section, so index 0 exists.
        return this.visibleViews(entry)[0].id;
    }

    private titleGroups(entry: ContainerEntry): IMenuEntryGroup[] {
        const viewId = this.headerTargetView(entry);
        return viewId === null
            ? this.containerTitleGroups(attached(entry).descriptor.id)
            : this.viewTitleGroups(viewId);
    }

    /**
     * A STATIC question, without `when`: keys change without events (`gitHasRepo`), and the header
     * is rebuilt only when the set of sections changes — asking "is it empty right now" would make
     * the button vanish forever.
     */
    private hasOverflow(menuId: MenuId, context: unknown): boolean {
        // A `navigation` group item with an icon becomes a button, and a selection submenu
        // of the same group becomes the title widget; neither ends up in the popup.
        return this.menuService.hasItems(menuId, context, (item) => {
            if (item.group !== NAVIGATION_GROUP) return true;
            if (isSubmenuContribution(item)) return item.isSelection !== true;
            return item.icon === undefined;
        });
    }

    private paneMenuPossible(entry: ContainerEntry, viewId: string): boolean {
        const viewContext: ViewMenuContext = { view: viewId };
        if (this.hasOverflow(MenuId.ViewTitle, viewContext)) return true;
        if (!this.isMerged(entry)) return false;
        // Merged: the container submenu moves into "⋯"; for a sidebar viewlet it always has "Move To".
        if (!this.isTabbed(entry)) return true;
        const containerContext: ViewContainerMenuContext = { container: attached(entry).descriptor.id };
        return this.menuService.hasItems(MenuId.ViewContainerTitle, containerContext) || entry.views.length >= 2;
    }

    private titleMenuPossible(entry: ContainerEntry): boolean {
        const viewId = this.headerTargetView(entry);
        if (viewId !== null) return this.paneMenuPossible(entry, viewId);
        // Only a sidebar viewlet ("⋯" always has "Move To") and a non-merged tab get here;
        // the latter has at least two visible sections, so it has "Views".
        return true;
    }

    private titleMenuEntries(entry: ContainerEntry): MenuEntry[] {
        const viewId = this.headerTargetView(entry);
        return viewId === null ? this.containerMenuEntries(entry) : this.paneMenuEntries(entry, viewId);
    }

    /**
     * Items' `when` and `enablement` depend on context keys, while the header rebuilds itself
     * only when the set of sections changes.
     */
    public refreshTitleActions(): void {
        for (const entry of this.containers.values()) {
            if (entry.paneView === null) continue;
            this.refreshContainerTitleActions(entry);
        }
    }

    /**
     * Only for the shown container; the rest are marked stale: menu resolution is the most expensive
     * part of building the header. Like upstream: only the open composite has a title toolbar.
     */
    private refreshContainerTitleActions(entry: ContainerEntry): void {
        const shown = this.isShown(entry);
        entry.titleActionsStale = !shown;
        const paneView = attached(entry).paneView;
        const headerViewId = this.headerTargetView(entry);
        for (const record of this.visibleViews(entry)) {
            if (shown) {
                paneView.setPaneActions(record.id, inlineActions(this.viewTitleGroups(record.id)));
                // A "⋯" that opens nothing looks broken (Explorer had this).
                paneView.setPaneMenuVisible(record.id, this.paneMenuPossible(entry, record.id));
            }
            // The widget and spinner are set even while hidden: the frame must be in place the moment it shows.
            // The widget of a section moved into the tab bar goes to the container header: it can have only one parent.
            paneView.setPaneTitleWidget(record.id, record.id === headerViewId ? null : record.titleWidget);
            // Headers were just recreated — give them back the spinner frame,
            // otherwise an operation started before the rebuild loses its indicator.
            this.applySpinner(entry, record);
        }
        if (!shown) return;
        // The header is created in attachContainer before the first section rebuild.
        const header = attached(entry).header;
        const actions = inlineActions(this.titleGroups(entry));
        header.setActions(actions);
        // Stryker disable next-line ConditionalExpression: a sidebar viewlet has no tab bar — its widget is null (headerTargetView), the header menu with 2+ sections is visible anyway, and partOf returns panelService, which skips an unknown id
        if (!this.isTabbed(entry)) return;
        const headerRecord = headerViewId === null ? null : this.recordOrThrow(headerViewId).record;
        const widget = headerRecord?.titleWidget ?? null;
        header.setTitleWidget(widget);
        const hasMenu = this.titleMenuPossible(entry);
        header.setMenuVisible(hasMenu);
        // An empty strip gets no room in the tab bar. The spinner counts as content too, otherwise
        // a panel section's progress would be invisible.
        // Stryker disable next-line OptionalChaining: the chain reaches this operand only when `!hasMenu`, and hasMenu is always true when headerRecord is null (2+ sections) — so the record always exists here
        const empty = actions.length === 0 && widget === null && !hasMenu && headerRecord?.spinner == null;
        this.partOf(entry).setViewActions(attached(entry).descriptor.id, empty ? null : header);
    }

    private refreshStaleTitleActions(containerId: string): void {
        const entry = this.containers.get(containerId);
        if (entry?.paneView == null || !entry.titleActionsStale) return;
        this.refreshContainerTitleActions(entry);
    }

    /**
     * The active sidebar viewlet or the active panel tab. Visibility of the part itself is not
     * considered: toggling it (Ctrl+B, layout restore) bypasses these services.
     */
    private isShown(entry: ContainerEntry): boolean {
        const id = attached(entry).descriptor.id;
        return this.isTabbed(entry)
            ? this.partOf(entry).getActiveViewId() === id
            : this.sidebarService.getActiveViewletId() === id;
    }

    /** For a merged panel section, the tab bar control strip acts as its header. */
    private applySpinner(entry: ContainerEntry, record: ViewRecord): void {
        if (this.headerTargetView(entry) === record.id) attached(entry).header.setSpinnerFrame(record.spinner);
        else attached(entry).paneView.setPaneSpinner(record.id, record.spinner);
    }

    private syncContainerFrame(entry: ContainerEntry): void {
        const stack = entry.stack;
        if (stack === null) return;
        const paneView = attached(entry).paneView;
        const header = attached(entry).header;
        header.layoutStyle = { height: vflexFixed(1), width: "fill" };
        paneView.layoutStyle = { height: vflexFill(), width: "fill" };
        stack.replaceChildren(this.isMerged(entry) ? [paneView] : [header, paneView]);
    }

    private containerOrThrow(id: string): ContainerEntry {
        const entry = this.containers.get(id);
        if (entry === undefined) throw new Error(`ViewsService: unknown container id "${id}"`);
        return entry;
    }

    private recordOrThrow(viewId: string): { entry: ContainerEntry; record: ViewRecord } {
        const found = this.findRecord(viewId);
        if (found === undefined) throw new Error(`ViewsService: unknown view id "${viewId}"`);
        return found;
    }

    private findRecord(viewId: string): { entry: ContainerEntry; record: ViewRecord } | undefined {
        for (const entry of this.containers.values()) {
            const record = entry.views.find((v) => v.id === viewId);
            if (record !== undefined) return { entry, record };
        }
        return undefined;
    }

    private ensureEntry(containerId: string): ContainerEntry {
        let entry = this.containers.get(containerId);
        if (entry === undefined) {
            entry = {
                descriptor: null,
                // Stryker disable next-line StringLiteral: an unregistered container's location is never read — registerContainer overwrites it from the descriptor
                location: "sidebar",
                wanted: false,
                generated: false,
                views: [],
                hidden: new Set(),
                paneView: null,
                header: null,
                stack: null,
                view: null,
                // Stryker disable next-line BooleanLiteral: equivalent — before attachContainer showing stops at `paneView === null`, and attach always rebuilds the sections and rewrites the flag
                titleActionsStale: false,
            };
            this.containers.set(containerId, entry);
        }
        return entry;
    }

    private visibleViews(entry: ContainerEntry): ViewRecord[] {
        return entry.views.filter((v) => !entry.hidden.has(v.id));
    }

    /** Exactly one visible section — the container and section headers merge. */
    private isMerged(entry: ContainerEntry): boolean {
        return this.visibleViews(entry).length === 1;
    }

    /** A tab in a part's tab bar (panel or auxiliary bar), not a sidebar viewlet. */
    private isTabbed(entry: ContainerEntry): boolean {
        return entry.location === "panel" || entry.location === "auxiliarybar";
    }

    private partOf(entry: ContainerEntry): PaneCompositePartService {
        return entry.location === "auxiliarybar" ? this.auxiliaryBarService : this.panelService;
    }

    private bodyOf(record: ViewRecord): TUIElement {
        if (record.body !== null && !this.isGatedOut(record)) return record.body;
        if (record.placeholderView === null) {
            record.placeholderView = this.createPlaceholder(record);
            record.placeholderView.id = `viewPlaceholder-${record.id.replaceAll(".", "-")}`;
        }
        return record.placeholderView;
    }

    /** The section requires a folder and there is none — the empty state is shown instead of the body. */
    private isGatedOut(record: ViewRecord): boolean {
        return record.requiresWorkspaceFolder && this.workspaceContext.getWorkbenchState() === "empty";
    }

    private createPlaceholder(record: ViewRecord): TUIElement {
        const placeholder = record.placeholder;
        if (placeholder === undefined || typeof placeholder === "string") {
            return createViewPlaceholder(placeholder ?? "");
        }
        // Built-in empty states only name commands; URLs are an extension's (`ExtensionViewWelcomes`).
        return new ViewWelcomeElement(placeholder, (target) => {
            if ("command" in target) this.commands.execute(target.command, ...(target.args ?? []));
        });
    }

    /**
     * No section rebuild needed: only the body changes, and collapsed state and weights must
     * survive opening a folder.
     */
    private refreshWorkspaceGatedViews(): void {
        for (const entry of this.containers.values()) {
            const paneView = entry.paneView;
            if (paneView === null) continue;
            for (const record of entry.views) {
                if (!record.requiresWorkspaceFolder || entry.hidden.has(record.id)) continue;
                paneView.setPaneBody(record.id, this.bodyOf(record));
            }
        }
    }

    /** Collapsed state and weights survive the rebuild, otherwise showing a hidden section would reset the layout. */
    private rebuildPanes(entry: ContainerEntry): void {
        const paneView = attached(entry).paneView;
        // A section not yet in the container gets the descriptor default.
        const previous = new Map(paneView.getPaneIds().map((id) => [id, paneView.isCollapsed(id)]));
        const weights = paneView.getWeights();
        for (const paneId of [...paneView.getPaneIds()]) {
            paneView.removePane(paneId);
        }
        const visible = this.visibleViews(entry);
        const merged = visible.length === 1;
        // In the panel a merged section's header is the tab itself, so it gets no row.
        const headerVisible = !(merged && this.isTabbed(entry));
        for (const view of visible) {
            paneView.addPane({
                id: view.id,
                // Merged in the sidebar: the single section's header is the container header.
                title: merged && !this.isTabbed(entry) ? containerPaneTitle(entry) : view.title,
                description: view.description,
                body: this.bodyOf(view),
                minBodyHeight: view.minBodyHeight,
                collapsible: !merged,
                headerVisible,
                switcher: merged && !this.isTabbed(entry),
            });
        }
        paneView.setWeights(weights);
        for (const view of visible) {
            paneView.setCollapsed(view.id, previous.get(view.id) ?? view.collapsed);
        }
        this.refreshContainerTitleActions(entry);
        this.syncContainerFrame(entry);
        this.syncExpanded(entry);
    }

    private persistContainerState(containerId: string, entry: ContainerEntry): void {
        const paneView = attached(entry).paneView;
        const state: IViewContainerViewsState = {
            // Write BOTH states, not just the collapsed ones: being expanded is also
            // the user's choice and must override the descriptor default.
            collapsed: Object.fromEntries(paneView.getPaneIds().map((id) => [id, paneView.isCollapsed(id)])),
            weights: paneView.getWeights(),
            hidden: [...entry.hidden],
        };
        this.stateService.store(SIDEBAR_VIEWS_STATE, {
            ...this.stateService.get(SIDEBAR_VIEWS_STATE),
            [containerId]: state,
        });
    }
}

/**
 * `undefined` — the store doesn't know the section, the descriptor default applies. Stores from older
 * versions held an array of collapsed ids, which says nothing about the unlisted ones.
 */
function storedCollapsed(stored: StoredCollapsed, viewId: string): boolean | undefined {
    if (isLegacyCollapsedList(stored)) return stored.includes(viewId) ? true : undefined;
    return stored[viewId];
}

type StoredCollapsed = IViewContainerViewsState["collapsed"];

function isLegacyCollapsedList(stored: StoredCollapsed): stored is readonly string[] {
    return Array.isArray(stored);
}

/** Strip the legacy format's leading spaces — the header draws the indent itself. */
function containerPaneTitle(entry: ContainerEntry): string {
    return containerTitle(entry).trimStart();
}

/**
 * A generated container has no title of its own (upstream uses an invisible "User View
 * Container" stub), so it carries its first view's title.
 */
function containerTitle(entry: ContainerEntry): string {
    // Stryker disable next-line OptionalChaining,StringLiteral: an emptied generated container is removed right away (syncPresence) — its title is never asked for without views
    if (entry.generated) return entry.views.at(0)?.title ?? "";
    return attached(entry).descriptor.title;
}

/**
 * No padding of its own: the location provides it, and an extra column would clip the hint in a
 * narrow panel.
 */
function createViewPlaceholder(text: string): TUIElement {
    const label = new TextLabelElement(text);
    label.style = { fg: "descriptionForeground" };
    return label;
}
