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
 * Контрол `WorkbenchLayoutElement` остаётся у владельца view и приходит через
 * {@link attachLayout}: элемент про DI/StateService не знает. Истина видимости нижней
 * панели — {@link PanelService}, вторичной — {@link AuxiliaryBarService}; layout и
 * контекст-ключи следуют за их `onDidChangeVisibility`.
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
    /** Пока идёт restore, сеттеры элемента фаерят `onDidChangeLayout` — глушим авто-capture. */
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
        // Стартовое значение — сразу: рестор, совпавший с ним, события не даст.
        this.contextKeys.set("panelVisible", this.panelService.visible);
        this.register(
            this.panelService.onDidChangeVisibility((visible) => {
                this.layout?.setBottomPanelVisible(visible);
                this.layout?.markDirty();
                this.contextKeys.set("panelVisible", visible);
            }),
        );
        // Активная вкладка живёт в PanelService и меняется мимо layout-элемента,
        // поэтому write-through у неё свой (onDidChangeLayout её не видит).
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
     * Аналог `ILayoutService.mainContainer`. Звать ПЕРВЫМ, до резолва фич: оверлеи
     * создают сессии на её слое в своих конструкторах.
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
     * Синхронизирует видимость в сервисах частей — иначе первый toggle после рестора
     * отработал бы вхолостую. Звать после сборки контейнеров: пустую вторичную панель рестор не показывает.
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
            // Программная активация (не `activateView`) — ленивые фичи не будят:
            // вкладка TERMINAL восстанавливается с placeholder'ом, шелл не спавним.
            const activeViewId = this.state.get(PANEL_ACTIVE_VIEW_STATE);
            if (activeViewId !== "") this.panelService.setActiveView(activeViewId);
            this.auxiliaryBarService.setActiveView(this.state.get(AUXILIARYBAR_ACTIVE_VIEW_STATE));
            // Истина видимости — в сервисы частей; их подписчики двигают layout
            // повторно, и эта запись — тоже рестор, а не действие пользователя:
            // впервые открытый воркспейс продолжает выводить видимость из настройки.
            this.panelService.setVisible(layout.getBottomPanelVisible());
            this.auxiliaryBarService.setVisible(layout.getRightPanelVisible());
        } finally {
            this.restoring = false;
        }
    }

    /**
     * Впервые открытому воркспейсу — `workbench.secondarySideBar.defaultVisibility`
     * (`getDefaultAuxiliaryBarHidden` эталона). Без контейнеров — скрыта, как и у эталона.
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
        // "visible", "maximized" — видима и в пустом окне.
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

    /** Так `SidebarService` переключает вьюлеты без activity bar. */
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

    /** Аналог `hasFocus(part)`; фокус вне боковых частей и панели — редактор. */
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
     * `workbench.action.increaseViewSize` эталона. Редактор растёт за счёт соседей, как в
     * сетке эталона: по ширине первой уступает вторичная панель, затем сайдбар.
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
