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

/** Части workbench'а, между которыми ходит фокус (подмножество `Parts` эталона). */
export type WorkbenchPart = "sidebar" | "editor" | "panel" | "auxiliarybar";

/** Значения `workbench.secondarySideBar.defaultVisibility` (enum эталона). */
type SecondarySideBarDefaultVisibility =
    | "hidden"
    | "visibleInWorkspace"
    | "visible"
    | "maximizedInWorkspace"
    | "maximized";

/**
 * Логика workbench-layout'а: видимость/ширина сайдбара, видимость нижней панели
 * и вторичной боковой панели и персист layout-состояния через
 * {@link IStateService} (write-through по `onDidChangeLayout` — drag сэша и
 * команды).
 *
 * Сам контрол `WorkbenchLayoutElement` остаётся у владельца корневой view
 * (`WorkbenchComponent`) и приходит через late-init шов {@link attachLayout} —
 * элемент про DI/StateService не знает, сервис читает/пишет его через
 * публичные геттеры/сеттеры.
 *
 * Истина видимости нижней панели — {@link PanelService}, вторичной панели —
 * {@link AuxiliaryBarService}: команды зовут их `setVisible`, а layout и
 * контекст-ключи `panelVisible`/`auxiliaryBarVisible` следуют за
 * `onDidChangeVisibility` (подписки в конструкторе).
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
        // Видимость панели живёт в PanelService; layout и контекст-ключ следуют за ней.
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
        // Вторичная боковая панель — та же пара «истина в сервисе части, layout
        // и ключ следуют».
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
     * Прикрепляет корневую view окна (аналог `ILayoutService.mainContainer`
     * VS Code). Владелец view зовёт это ПЕРВЫМ делом, до резолва фич: оверлеи
     * создают сессии на её слое в своих конструкторах.
     */
    public attachRoot(root: BodyElement): void {
        this.root = root;
    }

    /**
     * Корневая view окна: её overlay-слой — общий хост попапов и модалок.
     * До {@link attachRoot} — ошибка, как и у layout'а.
     */
    public get mainContainer(): BodyElement {
        if (this.root === null) {
            throw new Error("LayoutService: root is not attached (attachRoot must be called first)");
        }
        return this.root;
    }

    /**
     * Прикрепляет layout-элемент (зовёт владелец view сразу после его создания)
     * и вешает write-through: любое пользовательское изменение layout'а
     * (drag сэша, команда) снимается в стор.
     */
    public attachLayout(layout: WorkbenchLayoutElement): void {
        this.layout = layout;
        layout.onDidChangeLayout = () => {
            this.captureLayout();
        };
    }

    /**
     * Применяет сохранённый layout к элементу через его публичные сеттеры и
     * синхронизирует истину видимости частей в их сервисах (иначе первый toggle
     * после рестора отработал бы вхолостую). Зовётся до первого кадра (из
     * `mount()` владельца) — после сборки контейнеров: пустую вторичную панель
     * рестор не показывает.
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
            // Пустой id (вкладку не выбирали) сервис части пропускает сам.
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
     * Скрыта ли вторичная панель на старте. Сохранённое значение — у этого
     * воркспейса; впервые открытому — `workbench.secondarySideBar.defaultVisibility`
     * (как `getDefaultAuxiliaryBarHidden` эталона). Часть без единого
     * контейнера показывать нечем — у эталона рестор, не нашедший контейнера,
     * тоже помечает её скрытой.
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

    /** Снимает текущий layout из элемента в стор (write-through). No-op во время restore. */
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

    // ── Сайдбар ─────────────────────────────────────────────────────────────

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

    /**
     * Подменяет контент сайдбара (левой панели) — так `SidebarService`
     * переключает вьюлеты (Explorer ↔ Source Control) без activity bar. Сам
     * реестр вьюлетов живёт в сервисе, layout лишь показывает переданный элемент.
     */
    public setSidebarContent(element: TUIElement | null): void {
        const layout = this.requireLayout();
        layout.setLeftPanel(element);
        layout.markDirty();
    }

    /** Grow/shrink the sidebar by `delta` columns, clamped by the layout element. */
    public nudgeSidebarWidth(delta: number): void {
        this.requireLayout().nudgeLeftPanelWidth(delta);
    }

    /** Restore the sidebar to its default width. */
    public resetSidebarWidth(): void {
        this.requireLayout().resetLeftPanelWidth();
    }

    // ── Нижняя панель ───────────────────────────────────────────────────────

    public isPanelVisible(): boolean {
        return this.requireLayout().getBottomPanelVisible();
    }

    /**
     * Shows/hides the bottom Panel. Истина видимости — {@link PanelService};
     * layout и контекст-ключ `panelVisible` следуют за ней через подписку
     * `onDidChangeVisibility` (см. конструктор).
     */
    public setPanelVisible(visible: boolean): void {
        this.panelService.setVisible(visible);
    }

    // ── Вторичная боковая панель ────────────────────────────────────────────

    public isAuxiliaryBarVisible(): boolean {
        return this.requireLayout().getRightPanelVisible();
    }

    /**
     * Shows/hides the Secondary Side Bar. Истина видимости —
     * {@link AuxiliaryBarService}; layout и контекст-ключ `auxiliaryBarVisible`
     * следуют за ней через подписку (см. конструктор).
     */
    public setAuxiliaryBarVisible(visible: boolean): void {
        this.auxiliaryBarService.setVisible(visible);
    }

    /** Grow/shrink the Secondary Side Bar by `delta` columns, clamped by the layout element. */
    public nudgeAuxiliaryBarWidth(delta: number): void {
        this.requireLayout().nudgeRightPanelWidth(delta);
    }

    // ── Фокус и ресайз по фокусу ────────────────────────────────────────────

    /**
     * Часть, в поддереве которой фокус (аналог `hasFocus(part)` эталона);
     * фокус вне боковых частей и панели считается редактором.
     */
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
     * Ресайз части с фокусом (`workbench.action.increaseViewSize` /
     * `decreaseViewSize` эталона): боковые части меняют ширину на
     * `columns`, панель — высоту на `rows`. Редактор растёт за счёт соседей,
     * как в сетке эталона: по ширине первой уступает вторичная панель, затем
     * сайдбар; по высоте — нижняя панель.
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
