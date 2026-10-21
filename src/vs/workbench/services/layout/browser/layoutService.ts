import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { BodyElement } from "@tuidom/elements/body/bodyElement";

import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IStateService } from "../../../../platform/state/common/iStateService.ts";
import { StateServiceDIToken } from "../../../../platform/state/common/iStateService.ts";
import type { IWorkspaceContextService } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { IWorkspaceContextServiceDIToken } from "../../../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import type { AuxiliaryBarService } from "../../../browser/parts/auxiliarybar/auxiliaryBarService.ts";
import { AuxiliaryBarServiceDIToken } from "../../../browser/parts/auxiliarybar/auxiliaryBarService.ts";
import type { PanelService } from "../../../browser/parts/panel/panelService.ts";
import { PanelServiceDIToken } from "../../../browser/parts/panel/panelService.ts";
import type { WorkbenchLayoutElement } from "../../../browser/workbenchLayoutElement.ts";
import {
    AUXILIARYBAR_ACTIVE_VIEW_STATE,
    AUXILIARYBAR_HIDDEN_STATE,
    AUXILIARYBAR_SIZE_STATE,
    PANEL_ACTIVE_VIEW_STATE,
    PANEL_HEIGHT_STATE,
    PANEL_VISIBLE_STATE,
    SIDEBAR_VISIBLE_STATE,
    SIDEBAR_WIDTH_STATE,
} from "../../../common/stateKeys.ts";

export const LayoutServiceDIToken = token<LayoutService>("LayoutService");

export type WorkbenchPart = "sidebar" | "editor" | "panel" | "auxiliarybar";

type SecondarySideBarDefaultVisibility =
    | "hidden"
    | "visibleInWorkspace"
    | "visible"
    | "maximizedInWorkspace"
    | "maximized";

/**
 * The `WorkbenchLayoutElement` control stays with the view owner and arrives via
 * {@link attachLayout}: the element knows nothing about DI/StateService. The source of truth
 * for bottom panel visibility is {@link PanelService}, for the secondary one
 * {@link AuxiliaryBarService}; layout and context keys follow their `onDidChangeVisibility`.
 */
export class LayoutService extends Disposable {
    public static dependencies = [
        StateServiceDIToken,
        PanelServiceDIToken,
        ContextKeyServiceDIToken,
        AuxiliaryBarServiceDIToken,
        IConfigurationServiceDIToken,
        IWorkspaceContextServiceDIToken,
    ] as const;

    private layout: WorkbenchLayoutElement | null = null;
    private root: BodyElement | null = null;
    /** During restore the element setters fire `onDidChangeLayout`; this suppresses auto-capture. */
    private restoring = false;

    public constructor(
        private readonly state: IStateService,
        private readonly panelService: PanelService,
        private readonly contextKeys: ContextKeyService,
        private readonly auxiliaryBarService: AuxiliaryBarService,
        private readonly configuration: IConfigurationService,
        private readonly workspaceContext: IWorkspaceContextService,
    ) {
        super();
        // Set the initial value eagerly: a restore that matches it fires no event.
        this.contextKeys.set("panelVisible", this.panelService.visible);
        this.register(
            this.panelService.onDidChangeVisibility((visible) => {
                this.layout?.setBottomPanelVisible(visible);
                this.layout?.markDirty();
                this.contextKeys.set("panelVisible", visible);
            }),
        );
        // The active tab lives in PanelService and changes bypassing the layout element,
        // so it has its own write-through (onDidChangeLayout doesn't see it).
        this.register(
            this.panelService.onDidChangeActiveView((id) => {
                if (this.restoring) return;
                this.state.store(PANEL_ACTIVE_VIEW_STATE, id);
            }),
        );
        this.contextKeys.set("auxiliaryBarVisible", this.auxiliaryBarService.visible);
        this.register(
            this.auxiliaryBarService.onDidChangeVisibility((visible) => {
                this.layout?.setRightPanelVisible(visible);
                this.layout?.markDirty();
                this.contextKeys.set("auxiliaryBarVisible", visible);
            }),
        );
        this.register(
            this.auxiliaryBarService.onDidChangeActiveView((id) => {
                if (this.restoring) return;
                this.state.store(AUXILIARYBAR_ACTIVE_VIEW_STATE, id);
            }),
        );
    }

    /**
     * Counterpart of `ILayoutService.mainContainer`. Call FIRST, before features resolve: overlays
     * create sessions on the root's layer in their constructors.
     */
    public attachRoot(root: BodyElement): void {
        this.root = root;
    }

    public get mainContainer(): BodyElement {
        if (this.root === null) {
            throw new Error("LayoutService: root is not attached (attachRoot must be called first)");
        }
        return this.root;
    }

    public attachLayout(layout: WorkbenchLayoutElement): void {
        this.layout = layout;
        layout.onDidChangeLayout = () => {
            this.captureLayout();
        };
    }

    /**
     * Syncs visibility into the part services, otherwise the first toggle after restore
     * would be a no-op. Call after containers are built: restore doesn't show an empty secondary panel.
     */
    public restoreLayout(): void {
        const layout = this.requireLayout();
        this.restoring = true;
        try {
            layout.setLeftPanelWidth(this.state.get(SIDEBAR_WIDTH_STATE));
            layout.setLeftPanelVisible(this.state.get(SIDEBAR_VISIBLE_STATE));
            layout.setBottomPanelHeight(this.state.get(PANEL_HEIGHT_STATE));
            layout.setBottomPanelVisible(this.state.get(PANEL_VISIBLE_STATE));
            layout.setRightPanelWidth(this.state.get(AUXILIARYBAR_SIZE_STATE));
            layout.setRightPanelVisible(!this.restoreAuxiliaryBarHidden());
            layout.markDirty();
            // Programmatic activation (not `activateView`) doesn't wake lazy features:
            // the TERMINAL tab is restored with a placeholder, no shell is spawned.
            const activeViewId = this.state.get(PANEL_ACTIVE_VIEW_STATE);
            if (activeViewId !== "") this.panelService.setActiveView(activeViewId);
            this.auxiliaryBarService.setActiveView(this.state.get(AUXILIARYBAR_ACTIVE_VIEW_STATE));
            // Visibility goes to the part services, its source of truth; their subscribers move the layout
            // again, and this write is also a restore, not a user action:
            // a first-time workspace keeps deriving visibility from the setting.
            this.panelService.setVisible(layout.getBottomPanelVisible());
            this.auxiliaryBarService.setVisible(layout.getRightPanelVisible());
        } finally {
            this.restoring = false;
        }
    }

    /**
     * A first-time workspace uses `workbench.secondarySideBar.defaultVisibility`
     * (upstream `getDefaultAuxiliaryBarHidden`). Without containers it is hidden, as upstream.
     */
    private restoreAuxiliaryBarHidden(): boolean {
        if (this.auxiliaryBarService.getViews().length === 0) return true;
        const stored = this.state.get(AUXILIARYBAR_HIDDEN_STATE);
        if (stored !== null) return stored;
        const setting =
            this.configuration.get<SecondarySideBarDefaultVisibility>("workbench.secondarySideBar.defaultVisibility") ??
            "visibleInWorkspace";
        switch (setting) {
            case "hidden":
                return true;
            case "visibleInWorkspace":
            case "maximizedInWorkspace":
                return this.workspaceContext.getWorkbenchState() === "empty";
        }
        // "visible", "maximized": visible even in an empty window.
        return false;
    }

    public captureLayout(): void {
        if (this.restoring) return;
        const layout = this.requireLayout();
        this.state.store(SIDEBAR_WIDTH_STATE, layout.getLeftPanelWidth());
        this.state.store(SIDEBAR_VISIBLE_STATE, layout.getLeftPanelVisible());
        this.state.store(PANEL_HEIGHT_STATE, layout.getBottomPanelHeight());
        this.state.store(PANEL_VISIBLE_STATE, layout.getBottomPanelVisible());
        this.state.store(PANEL_ACTIVE_VIEW_STATE, this.panelService.getActiveViewId() ?? "");
        this.state.store(AUXILIARYBAR_SIZE_STATE, layout.getRightPanelWidth());
        this.state.store(AUXILIARYBAR_HIDDEN_STATE, !layout.getRightPanelVisible());
        this.state.store(AUXILIARYBAR_ACTIVE_VIEW_STATE, this.auxiliaryBarService.getActiveViewId() ?? "");
    }

    public isSidebarVisible(): boolean {
        return this.requireLayout().getLeftPanelVisible();
    }

    public setSidebarVisible(visible: boolean): void {
        const layout = this.requireLayout();
        layout.setLeftPanelVisible(visible);
        layout.markDirty();
    }

    public toggleSidebar(): void {
        this.setSidebarVisible(!this.isSidebarVisible());
    }

    /** How `SidebarService` switches viewlets without an activity bar. */
    public setSidebarContent(element: TUIElement | null): void {
        const layout = this.requireLayout();
        layout.setLeftPanel(element);
        layout.markDirty();
    }

    public nudgeSidebarWidth(delta: number): void {
        this.requireLayout().nudgeLeftPanelWidth(delta);
    }

    public resetSidebarWidth(): void {
        this.requireLayout().resetLeftPanelWidth();
    }

    public isPanelVisible(): boolean {
        return this.requireLayout().getBottomPanelVisible();
    }

    public setPanelVisible(visible: boolean): void {
        this.panelService.setVisible(visible);
    }

    public isAuxiliaryBarVisible(): boolean {
        return this.requireLayout().getRightPanelVisible();
    }

    public setAuxiliaryBarVisible(visible: boolean): void {
        this.auxiliaryBarService.setVisible(visible);
    }

    public nudgeAuxiliaryBarWidth(delta: number): void {
        this.requireLayout().nudgeRightPanelWidth(delta);
    }

    /** Counterpart of `hasFocus(part)`; focus outside the side parts and the panel means the editor. */
    public getFocusedPart(): WorkbenchPart {
        const layout = this.requireLayout();
        const active = this.root?.focusManager?.activeElement ?? null;
        if (active === null) return "editor";
        const path = active.getAncestorPath();
        const owns = (part: TUIElement | null): boolean => path.some((node) => node === part);
        if (owns(layout.getLeftPanel())) return "sidebar";
        if (owns(layout.getRightPanel())) return "auxiliarybar";
        if (owns(layout.getBottomPanel())) return "panel";
        return "editor";
    }

    /**
     * Upstream `workbench.action.increaseViewSize`. The editor grows at its neighbors' expense, as in
     * the upstream grid: horizontally the secondary panel yields first, then the sidebar.
     */
    public resizeFocusedPart(columns: number, rows: number): void {
        const layout = this.requireLayout();
        switch (this.getFocusedPart()) {
            case "sidebar":
                layout.nudgeLeftPanelWidth(columns);
                return;
            case "auxiliarybar":
                layout.nudgeRightPanelWidth(columns);
                return;
            case "panel":
                layout.nudgeBottomPanelHeight(rows);
                return;
            case "editor":
                if (layout.getRightPanelVisible()) layout.nudgeRightPanelWidth(-columns);
                else if (layout.getLeftPanelVisible()) layout.nudgeLeftPanelWidth(-columns);
                if (layout.getBottomPanelVisible()) layout.nudgeBottomPanelHeight(-rows);
                return;
        }
    }

    private requireLayout(): WorkbenchLayoutElement {
        if (this.layout === null) {
            throw new Error("LayoutService: layout is not attached (attachLayout must be called first)");
        }
        return this.layout;
    }
}
