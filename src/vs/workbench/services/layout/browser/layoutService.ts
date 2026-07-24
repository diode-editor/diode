import { Disposable } from "../../../../../../tuidom/common/disposable.ts";
import type { TUIElement } from "../../../../../../tuidom/dom/tuiElement.ts";
import type { WorkbenchLayoutElement } from "../../../../../../tuidom/ui/workbenchlayout/workbenchLayoutElement.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IStateService } from "../../../../platform/state/common/iStateService.ts";
import type { PanelService } from "../../../browser/parts/panel/panelService.ts";
import { PanelServiceDIToken } from "../../../browser/parts/panel/panelService.ts";
import { StateServiceDIToken } from "../../../common/coreTokens.ts";
import {
    PANEL_ACTIVE_VIEW_STATE,
    PANEL_HEIGHT_STATE,
    PANEL_VISIBLE_STATE,
    SIDEBAR_VISIBLE_STATE,
    SIDEBAR_WIDTH_STATE,
} from "../../../common/stateKeys.ts";

export const LayoutServiceDIToken = token<LayoutService>("LayoutService");

/**
 * Логика workbench-layout'а: видимость/ширина сайдбара, видимость нижней панели
 * и персист layout-состояния через {@link IStateService} (write-through по
 * `onDidChangeLayout` — drag сэша и команды).
 *
 * Сам контрол `WorkbenchLayoutElement` остаётся у владельца корневой view
 * (`WorkbenchComponent`) и приходит через late-init шов {@link attachLayout} —
 * TUIDom про DI/StateService не знает, сервис читает/пишет элемент через его
 * публичные геттеры/сеттеры.
 *
 * Истина видимости панели — {@link PanelService}: команды зовут
 * {@link setPanelVisible} → `PanelService.setVisible`, а layout и контекст-ключ
 * `panelVisible` следуют за `onDidChangeVisibility` (подписка в конструкторе).
 */
export class LayoutService extends Disposable {
    public static dependencies = [StateServiceDIToken, PanelServiceDIToken, ContextKeyServiceDIToken] as const;

    private layout: WorkbenchLayoutElement | null = null;
    /** Пока идёт restore, сеттеры элемента фаерят `onDidChangeLayout` — глушим авто-capture. */
    private restoring = false;

    public constructor(
        private readonly state: IStateService,
        private readonly panelService: PanelService,
        private readonly contextKeys: ContextKeyService,
    ) {
        super();
        // Видимость панели живёт в PanelService; layout и контекст-ключ следуют за ней.
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
     * синхронизирует истину видимости панели в {@link PanelService} (иначе
     * первый toggle после рестора отработал бы вхолостую). Зовётся до первого
     * кадра (из `mount()` владельца).
     */
    public restoreLayout(): void {
        const layout = this.requireLayout();
        this.restoring = true;
        try {
            layout.setLeftPanelWidth(this.state.get(SIDEBAR_WIDTH_STATE));
            layout.setLeftPanelVisible(this.state.get(SIDEBAR_VISIBLE_STATE));
            layout.setBottomPanelHeight(this.state.get(PANEL_HEIGHT_STATE));
            layout.setBottomPanelVisible(this.state.get(PANEL_VISIBLE_STATE));
            layout.markDirty();
            // Программная активация (не `activateView`) — ленивые фичи не будят:
            // вкладка TERMINAL восстанавливается с placeholder'ом, шелл не спавним.
            const activeViewId = this.state.get(PANEL_ACTIVE_VIEW_STATE);
            if (activeViewId !== "") this.panelService.setActiveView(activeViewId);
        } finally {
            this.restoring = false;
        }
        this.panelService.setVisible(layout.getBottomPanelVisible());
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
     * Подменяет контент сайдбара (левой панели) — так {@link SidebarService}
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

    private requireLayout(): WorkbenchLayoutElement {
        if (this.layout === null) {
            throw new Error("LayoutService: layout is not attached (attachLayout must be called first)");
        }
        return this.layout;
    }
}
