import type { TUIElement } from "../../../../../../tuidom/dom/tuiElement.ts";
import { VFlexElement, vflexFill, vflexFixed } from "../../../../../../tuidom/ui/layout/vFlexElement.ts";
import type { MenuEntry, MenuItemEntry, MenuSubmenuEntry } from "../../../../../../tuidom/ui/menu/popupMenuElement.ts";
import { TextLabelElement } from "../../../../../../tuidom/ui/text/textLabelElement.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { IMenuEntryGroup } from "../../../../platform/actions/common/menuRegistry.ts";
import { CHECKED_ICON, joinMenuGroups } from "../../../../platform/actions/common/menuRegistry.ts";
import type { MenuService } from "../../../../platform/actions/common/menuService.ts";
import { MenuServiceDIToken } from "../../../../platform/actions/common/menuService.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { ContextMenuServiceDIToken } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IStateService } from "../../../../platform/state/common/iStateService.ts";
import type { ViewContainerMenuContext, ViewMenuContext } from "../../actions/menuContexts.ts";
import { StateServiceDIToken } from "../../../common/coreTokens.ts";
import { SIDEBAR_VIEWS_STATE, type IViewContainerViewsState } from "../../../common/stateKeys.ts";
import type { PanelService } from "../panel/panelService.ts";
import { PanelServiceDIToken } from "../panel/panelService.ts";
import type { SidebarService } from "../sidebar/sidebarService.ts";
import { SidebarServiceDIToken } from "../sidebar/sidebarService.ts";

import { PaneViewElement } from "./paneViewElement.ts";
import { ViewContainerHeaderElement } from "./viewContainerHeaderElement.ts";
import type { IViewTitleAction } from "./viewTitleRowElement.ts";

export const ViewsServiceDIToken = token<ViewsService>("ViewsService");

/** Спец-группа VS Code: её пункты рисуются кнопками в заголовке, а не в попапе. */
const NAVIGATION_GROUP = "navigation";

/** Подменю-переключатель видимости секций (VS Code: «Views»). */
const VIEWS_SUBMENU_LABEL = "Views";

/**
 * Где живёт контейнер (аналог `ViewContainerLocation` VS Code): вьюлет левого
 * сайдбара или вкладка нижней панели.
 */
export type ViewContainerLocation = "sidebar" | "panel";

/** Контейнер view-секций = «активити»: единица, которую показывает место (location). */
export interface IViewContainerDescriptor {
    /** Id контейнера (например `"scm"` — см. `SCM_VIEWLET_ID`). */
    readonly id: string;
    /**
     * Заголовок контейнера без ведущих пробелов (`"SOURCE CONTROL"`) — отступ
     * рисует заголовок, а не строка.
     */
    readonly title: string;
    readonly location: ViewContainerLocation;
    /** Порядок среди контейнеров одного места (меньше — раньше). */
    readonly order?: number;
}

/**
 * Дескриптор view-секции. `containerId` — реестровая связь, а не свойство
 * контрола: перенос view между контейнерами (как в VS Code) ляжет сюда же
 * сменой поля, без переделки модели.
 */
export interface IViewDescriptor {
    /** Глобально уникальный id view (например `"workbench.scm.changes"`). */
    readonly id: string;
    readonly containerId: string;
    /** Название секции — конвенция VS Code: КАПСОМ (`"CHANGES"`). */
    readonly title: string;
    /** Порядок секции в контейнере (меньше — выше). */
    readonly order: number;
    /**
     * Тело секции; `null` — контента ещё/уже нет, рисуется {@link placeholder}
     * (аналог `viewsWelcome` VS Code). Подменяется {@link ViewsService.setViewBody}.
     */
    readonly body: TUIElement | null;
    /** Текст пустого состояния, пока `body === null`. */
    readonly placeholder?: string;
    /** Отдать фокус содержимому view (команда показа, reveal контейнера). */
    readonly focus: () => void;
    readonly minBodyHeight?: number;
    /**
     * `false` — секцию нельзя скрыть через «⋯» контейнера (по умолчанию `true`).
     * Аналог `canToggleVisibility` у `IViewDescriptor` VS Code.
     */
    readonly canToggleVisibility?: boolean;
}

/** Снимок view для потребителей меню/переключателей (см. {@link ViewsService.getContainerViews}). */
export interface IViewSnapshot {
    readonly id: string;
    readonly title: string;
    readonly visible: boolean;
    readonly canToggleVisibility: boolean;
}

/** Изменяемая запись реестра: тело и виджет заголовка живут дольше дескриптора. */
interface ViewRecord {
    readonly id: string;
    readonly containerId: string;
    readonly title: string;
    readonly order: number;
    readonly focus: () => void;
    readonly minBodyHeight: number | undefined;
    readonly placeholder: string | undefined;
    readonly canToggleVisibility: boolean;
    body: TUIElement | null;
    titleWidget: TUIElement | null;
    /** Контрол пустого состояния — создаётся лениво и переиспользуется. */
    placeholderView: TUIElement | null;
}

interface ContainerEntry {
    /** null — контейнер ещё не зарегистрирован (в него только записались view). */
    descriptor: IViewContainerDescriptor | null;
    readonly views: ViewRecord[];
    /** Id скрытых пользователем секций (персистятся вместе со свёрнутостью). */
    readonly hidden: Set<string>;
    /** Появляются в {@link ViewsService.attachContainer}. */
    paneView: PaneViewElement | null;
    header: ViewContainerHeaderElement | null;
    /**
     * Корень контейнера — стабильный: merged-режим меняет НАБОР детей
     * (заголовок то есть, то нет), а не сам элемент, иначе место держало бы
     * ссылку на устаревший корень.
     */
    view: TUIElement | null;
}

/**
 * Реестр view-секций и сборщик контейнеров (лайт-аналог `IViewsService`/
 * `ViewContainerRegistry` VS Code). Компоненты регистрируют свои view
 * декларативно ({@link registerView}), workbench собирает контейнер
 * ({@link attachContainer}) и отдаёт его месту (`location`).
 *
 * **Merged-режим выводится, а не объявляется:** контейнер с ровно одной ВИДИМОЙ
 * view рисуется без рамки, а её заголовок несёт название контейнера и не
 * сворачивается (как VS Code сливает заголовок единственной секции с заголовком
 * контейнера). Скрыли вторую секцию — контейнер сам стал merged, вернули —
 * заголовки разъехались.
 *
 * Сервис же владеет обвязкой секций: персист свёрнутости/весов/скрытости
 * (write-through по действию пользователя, restore — строго после
 * `openWorkspace`) и меню «⋯» (`MenuId.ViewTitle` с императивной
 * фильтрацией по `menuContext.view`).
 */
export class ViewsService {
    public static dependencies = [
        SidebarServiceDIToken,
        PanelServiceDIToken,
        ContextMenuServiceDIToken,
        MenuServiceDIToken,
        StateServiceDIToken,
    ] as const;

    private readonly containers = new Map<string, ContainerEntry>();

    public constructor(
        private readonly sidebarService: SidebarService,
        private readonly panelService: PanelService,
        private readonly contextMenuService: ContextMenuService,
        private readonly menuService: MenuService,
        private readonly stateService: IStateService,
    ) {}

    /** Регистрирует контейнер (повторная регистрация заменяет описание). */
    public registerContainer(descriptor: IViewContainerDescriptor): void {
        this.ensureEntry(descriptor.id).descriptor = descriptor;
    }

    /**
     * Регистрирует view в контейнере. Порядок свободный: компоненты создаются
     * DI раньше, чем workbench регистрирует контейнеры, поэтому view можно
     * записать «в счёт» будущего контейнера. Повторная регистрация того же id
     * заменяет (идемпотентность при повторном setWorkspaceFolder); поздняя —
     * пересобирает секции уже построенного контейнера.
     */
    public registerView(descriptor: IViewDescriptor): void {
        const entry = this.ensureEntry(descriptor.containerId);
        const existing = entry.views.findIndex((v) => v.id === descriptor.id);
        if (existing >= 0) {
            entry.views.splice(existing, 1);
        }
        entry.views.push({
            id: descriptor.id,
            containerId: descriptor.containerId,
            title: descriptor.title,
            order: descriptor.order,
            focus: descriptor.focus,
            minBodyHeight: descriptor.minBodyHeight,
            placeholder: descriptor.placeholder,
            canToggleVisibility: descriptor.canToggleVisibility ?? true,
            body: descriptor.body,
            titleWidget: null,
            placeholderView: null,
        });
        entry.views.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
        if (entry.paneView !== null) {
            this.rebuildPanes(entry);
        }
    }

    /**
     * Подменяет тело view (null — вернуться к placeholder'у). Видимая секция
     * меняет тело на месте, сохраняя свёрнутость и вес.
     */
    public setViewBody(viewId: string, body: TUIElement | null): void {
        const { entry, record } = this.recordOrThrow(viewId);
        if (record.body === body) return;
        record.body = body;
        if (entry.paneView === null || entry.hidden.has(viewId)) return;
        entry.paneView.setPaneBody(viewId, this.bodyOf(record));
    }

    /**
     * Кладёт в заголовок view произвольный контрол (переключатель каналов
     * Output и подобные): escape-hatch для того, что не выражается пунктом меню.
     */
    public setViewTitleWidget(viewId: string, widget: TUIElement | null): void {
        const { entry, record } = this.recordOrThrow(viewId);
        if (record.titleWidget === widget) return;
        record.titleWidget = widget;
        if (entry.paneView === null || entry.hidden.has(viewId)) return;
        this.refreshTitleActions(entry);
    }

    /** Контрол заголовка view, если он задан (читает отрисовка заголовка). */
    public getViewTitleWidget(viewId: string): TUIElement | null {
        return this.recordOrThrow(viewId).record.titleWidget;
    }

    /** Снимок секций контейнера в порядке отображения (для меню-переключателя). */
    public getContainerViews(containerId: string): readonly IViewSnapshot[] {
        return this.containerOrThrow(containerId).views.map((v) => ({
            id: v.id,
            title: v.title,
            visible: !this.containerOrThrow(containerId).hidden.has(v.id),
            canToggleVisibility: v.canToggleVisibility,
        }));
    }

    public isViewVisible(viewId: string): boolean {
        const { entry } = this.recordOrThrow(viewId);
        return !entry.hidden.has(viewId);
    }

    /**
     * Показывает/скрывает секцию (пункт «Views» в меню контейнера) — с
     * write-through персиста. Последнюю видимую секцию скрыть нельзя: пустой
     * контейнер показывать нечем (так же ведёт себя VS Code).
     */
    public setViewVisible(viewId: string, visible: boolean): void {
        const { entry, record } = this.recordOrThrow(viewId);
        if (!record.canToggleVisibility) return;
        if (entry.hidden.has(viewId) === !visible) return;
        if (!visible && entry.views.filter((v) => !entry.hidden.has(v.id)).length <= 1) return;
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
     * Строит контрол контейнера и регистрирует его в его месте.
     * Зовётся из `WorkbenchComponent.setWorkspaceFolder`.
     */
    public attachContainer(containerId: string): void {
        const entry = this.containerOrThrow(containerId);
        if (entry.descriptor === null) {
            throw new Error(`ViewsService: container "${containerId}" is not registered`);
        }
        if (entry.view !== null) return;
        const paneView = new PaneViewElement();
        paneView.id = `viewContainer-${containerId}`;
        paneView.onDidChangeState = () => this.persistContainerState(containerId, entry);
        paneView.onDidRequestPaneMenu = (paneId, anchor) => {
            this.contextMenuService.showContextMenu({
                getOwner: () => paneView,
                getAnchor: () => anchor,
                getEntries: () => this.paneMenuEntries(entry, paneId),
            });
        };
        paneView.onDidRequestPaneAction = (paneId, actionId) => {
            runAction(this.viewTitleGroups(paneId), actionId);
        };
        entry.paneView = paneView;
        // В панели заголовка-строки нет — та же строка заголовка работает
        // полосой контролов в таб-строке, поэтому названия не несёт.
        const panel = entry.descriptor.location === "panel";
        const header = new ViewContainerHeaderElement(panel ? "" : entry.descriptor.title);
        header.id = `viewContainerHeader-${containerId.replaceAll(".", "-")}`;
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
        entry.header = header;
        if (panel) {
            entry.view = paneView;
            // Вкладку заводим ДО сборки секций: полоса контролов таб-строки
            // ставится через реестр панели, а он игнорирует незнакомый id.
            this.panelService.addView({ id: containerId, title: entry.descriptor.title, content: paneView });
            this.rebuildPanes(entry);
            return;
        }
        const root = new VFlexElement();
        // Id корня = id контейнера: стабильный селектор места для e2e/инспектора
        // (`#explorer`, `#scm`, `#search`).
        root.id = containerId.replaceAll(".", "-");
        root.style = { fg: "sideBar.foreground", bg: "sideBar.background" };
        entry.view = root;
        this.rebuildPanes(entry);
        this.sidebarService.registerViewlet(containerId, root, () => {
            this.focusContainer(containerId);
        });
    }

    /**
     * Применяет свёрнутость/веса/скрытость из workspace-стора ко всем
     * построенным контейнерам. Строго после `openWorkspace` (как
     * `restoreViewMode`), иначе прочитается global-стор. Без write-through.
     */
    public restoreViewsState(): void {
        const stored = this.stateService.get(SIDEBAR_VIEWS_STATE);
        for (const [containerId, entry] of this.containers) {
            const paneView = entry.paneView;
            const state = stored[containerId];
            if (paneView === null || state === undefined) continue;
            // Скрытость применяем до весов: она пересобирает секции, а
            // единственная оставшаяся видимой секция становится merged.
            const hidden = state.hidden ?? [];
            entry.hidden.clear();
            for (const viewId of hidden) {
                const record = entry.views.find((v) => v.id === viewId);
                if (record?.canToggleVisibility === true) entry.hidden.add(viewId);
            }
            // Все секции скрытыми быть не могут — протухший стор чиним молча.
            if (entry.views.length > 0 && entry.hidden.size === entry.views.length) {
                entry.hidden.delete(entry.views[0].id);
            }
            this.rebuildPanes(entry);
            paneView.setWeights(state.weights);
            for (const paneId of paneView.getPaneIds()) {
                paneView.setCollapsed(paneId, state.collapsed.includes(paneId));
            }
        }
    }

    /** Фокус первой развёрнутой видимой view контейнера (reveal, команды показа). */
    public focusContainer(containerId: string): void {
        const entry = this.containerOrThrow(containerId);
        const paneView = entry.paneView;
        if (paneView === null) return;
        const visible = this.visibleViews(entry);
        const target = visible.find((v) => !paneView.isCollapsed(v.id)) ?? visible[0];
        target?.focus();
    }

    // ─── Меню и inline-действия заголовков ───

    private viewTitleGroups(viewId: string): IMenuEntryGroup[] {
        const context: ViewMenuContext = { view: viewId };
        return this.menuService.getEntryGroups(MenuId.ViewTitle, context);
    }

    private containerTitleGroups(containerId: string): IMenuEntryGroup[] {
        const context: ViewContainerMenuContext = { container: containerId };
        return this.menuService.getEntryGroups(MenuId.ViewContainerTitle, context);
    }

    /** Попап «⋯» секции. Merged — сюда же уезжает меню контейнера, подменю. */
    private paneMenuEntries(entry: ContainerEntry, viewId: string): MenuEntry[] {
        const entries = overflowEntries(this.viewTitleGroups(viewId));
        if (!this.isMerged(entry)) return entries;
        const container = this.containerSubmenu(entry);
        if (container === null) return entries;
        return entries.length > 0 ? [...entries, { type: "separator" }, container] : [container];
    }

    /** Попап «⋯» контейнера: его команды + переключатель видимости секций. */
    private containerMenuEntries(entry: ContainerEntry): MenuEntry[] {
        const entries = overflowEntries(this.containerTitleGroups(entry.descriptor!.id));
        const views = this.viewsSubmenu(entry);
        if (views === null) return entries;
        return entries.length > 0 ? [...entries, { type: "separator" }, views] : [views];
    }

    /**
     * Меню контейнера, свёрнутое в подменю: у merged-контейнера своего
     * заголовка нет, поэтому его команды (включая inline-группу — рисовать её
     * негде) и переключатель секций живут в «⋯» единственной секции.
     */
    private containerSubmenu(entry: ContainerEntry): MenuSubmenuEntry | null {
        const own = joinMenuGroups(this.containerTitleGroups(entry.descriptor!.id));
        const views = this.viewsSubmenu(entry);
        const entries = views === null ? own : own.length > 0 ? [...own, { type: "separator" as const }, views] : [views];
        if (entries.length === 0) return null;
        return { type: "submenu", label: entry.descriptor!.title, entries };
    }

    /**
     * Подменю «Views» — чекбоксы видимости секций. Пункты динамические (их нет
     * в реестре меню), поэтому собираются здесь, а не контрибуцией.
     */
    private viewsSubmenu(entry: ContainerEntry): MenuSubmenuEntry | null {
        if (entry.views.length < 2) return null;
        return {
            type: "submenu",
            label: VIEWS_SUBMENU_LABEL,
            entries: entry.views.map((record) => {
                const visible = !entry.hidden.has(record.id);
                return {
                    label: record.title,
                    id: record.id,
                    icon: visible ? CHECKED_ICON : undefined,
                    onSelect: () => this.setViewVisible(record.id, !visible),
                };
            }),
        };
    }

    /**
     * Что представляет строка заголовка контейнера. В панели у merged-контейнера
     * своего заголовка нет — роль заголовка играет таб, поэтому полоса контролов
     * таб-строки несёт действия ЕДИНСТВЕННОЙ секции (как в VS Code).
     */
    private headerTargetView(entry: ContainerEntry): string | null {
        if (!this.isPanel(entry) || !this.isMerged(entry)) return null;
        return this.visibleViews(entry)[0]?.id ?? null;
    }

    private titleGroups(entry: ContainerEntry): IMenuEntryGroup[] {
        const viewId = this.headerTargetView(entry);
        return viewId === null ? this.containerTitleGroups(entry.descriptor!.id) : this.viewTitleGroups(viewId);
    }

    private titleMenuEntries(entry: ContainerEntry): MenuEntry[] {
        const viewId = this.headerTargetView(entry);
        return viewId === null ? this.containerMenuEntries(entry) : this.paneMenuEntries(entry, viewId);
    }

    /** Пере-резолвит inline-кнопки заголовков контейнера и его видимых секций. */
    private refreshTitleActions(entry: ContainerEntry): void {
        const paneView = entry.paneView!;
        const headerViewId = this.headerTargetView(entry);
        for (const record of this.visibleViews(entry)) {
            paneView.setPaneActions(record.id, inlineActions(this.viewTitleGroups(record.id)));
            // Виджет уехавшей в таб-строку секции забирает заголовок контейнера —
            // у контрола один родитель, держать его в двух местах нельзя.
            paneView.setPaneTitleWidget(record.id, record.id === headerViewId ? null : record.titleWidget);
        }
        const header = entry.header;
        if (header === null) return;
        const actions = inlineActions(this.titleGroups(entry));
        header.setActions(actions);
        if (!this.isPanel(entry)) return;
        const widget = headerViewId === null ? null : this.recordOrThrow(headerViewId).record.titleWidget;
        header.setTitleWidget(widget);
        const hasMenu = this.titleMenuEntries(entry).length > 0;
        header.setMenuVisible(hasMenu);
        // Пустой полосе в таб-строке места не даём — вкладка выглядит как раньше.
        const empty = actions.length === 0 && widget === null && !hasMenu;
        this.panelService.setViewActions(entry.descriptor!.id, empty ? null : header);
    }

    /**
     * Держит набор детей корня сайдбар-контейнера: merged обходится без
     * собственного заголовка (его роль играет заголовок единственной секции).
     * В панели корня-стопки нет — там заголовок живёт в таб-строке
     * ({@link refreshTitleActions}).
     */
    private syncContainerFrame(entry: ContainerEntry): void {
        const root = entry.view;
        if (root === null || this.isPanel(entry)) return;
        const paneView = entry.paneView!;
        const header = entry.header!;
        header.layoutStyle = { height: vflexFixed(1), width: "fill" };
        paneView.layoutStyle = { height: vflexFill(), width: "fill" };
        (root as VFlexElement).replaceChildren(this.isMerged(entry) ? [paneView] : [header, paneView]);
    }

    private containerOrThrow(id: string): ContainerEntry {
        const entry = this.containers.get(id);
        if (entry === undefined) throw new Error(`ViewsService: unknown container id "${id}"`);
        return entry;
    }

    private recordOrThrow(viewId: string): { entry: ContainerEntry; record: ViewRecord } {
        for (const entry of this.containers.values()) {
            const record = entry.views.find((v) => v.id === viewId);
            if (record !== undefined) return { entry, record };
        }
        throw new Error(`ViewsService: unknown view id "${viewId}"`);
    }

    private ensureEntry(containerId: string): ContainerEntry {
        let entry = this.containers.get(containerId);
        if (entry === undefined) {
            entry = { descriptor: null, views: [], hidden: new Set(), paneView: null, header: null, view: null };
            this.containers.set(containerId, entry);
        }
        return entry;
    }

    private visibleViews(entry: ContainerEntry): ViewRecord[] {
        return entry.views.filter((v) => !entry.hidden.has(v.id));
    }

    /** Ровно одна видимая секция — заголовки контейнера и секции сливаются. */
    private isMerged(entry: ContainerEntry): boolean {
        return this.visibleViews(entry).length === 1;
    }

    private isPanel(entry: ContainerEntry): boolean {
        return entry.descriptor?.location === "panel";
    }

    /** Тело секции: собственное либо (при `body === null`) пустое состояние. */
    private bodyOf(record: ViewRecord): TUIElement {
        if (record.body !== null) return record.body;
        if (record.placeholderView === null) {
            record.placeholderView = createViewPlaceholder(record.placeholder ?? "");
            record.placeholderView.id = `viewPlaceholder-${record.id.replaceAll(".", "-")}`;
        }
        return record.placeholderView;
    }

    /**
     * Пересобирает секции по реестру (первый build, поздняя регистрация, смена
     * видимости). Свёрнутость и веса переживают пересборку — иначе показ
     * скрытой секции сбрасывал бы раскладку остальных.
     */
    private rebuildPanes(entry: ContainerEntry): void {
        const paneView = entry.paneView!;
        const collapsed = new Set(paneView.getPaneIds().filter((id) => paneView.isCollapsed(id)));
        const weights = paneView.getWeights();
        for (const paneId of [...paneView.getPaneIds()]) {
            paneView.removePane(paneId);
        }
        const visible = this.visibleViews(entry);
        const merged = visible.length === 1;
        // В панели заголовок merged-секции — сам таб, поэтому строки под него нет.
        const headerVisible = !(merged && this.isPanel(entry));
        for (const view of visible) {
            paneView.addPane({
                id: view.id,
                // Merged в сайдбаре: единственная секция носит заголовок
                // контейнера и не сворачивается — её заголовок и есть заголовок
                // контейнера.
                title: merged && !this.isPanel(entry) ? containerPaneTitle(entry) : view.title,
                body: this.bodyOf(view),
                minBodyHeight: view.minBodyHeight,
                collapsible: !merged,
                headerVisible,
            });
        }
        paneView.setWeights(weights);
        for (const view of visible) {
            paneView.setCollapsed(view.id, collapsed.has(view.id));
        }
        this.refreshTitleActions(entry);
        this.syncContainerFrame(entry);
    }

    /** Write-through по действию пользователя (toggle секции, drag границы, скрытие). */
    private persistContainerState(containerId: string, entry: ContainerEntry): void {
        const paneView = entry.paneView!;
        const state: IViewContainerViewsState = {
            collapsed: paneView.getPaneIds().filter((id) => paneView.isCollapsed(id)),
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
 * Заголовок контейнера в роли заголовка merged-секции: ведущие пробелы, если
 * они остались от старого формата, срезаем — отступ рисует сам заголовок.
 */
function containerPaneTitle(entry: ContainerEntry): string {
    return (entry.descriptor?.title ?? "").trimStart();
}

/**
 * Inline-кнопки заголовка: группа `navigation`, у пунктов которой есть иконка.
 * Пункт без иконки кнопкой не нарисовать (в 30 колонок сайдбара не влезет
 * подпись), поэтому он остаётся в «⋯» — как и submenu-записи навигации.
 */
function inlineActions(groups: readonly IMenuEntryGroup[]): IViewTitleAction[] {
    const navigation = groups.find((group) => group.group === NAVIGATION_GROUP);
    if (navigation === undefined) return [];
    return navigation.entries.filter(isInlineItem).map((entry) => ({ id: entry.id, icon: entry.icon }));
}

/** Пункты попапа «⋯»: всё, что не уехало в inline-кнопки. */
function overflowEntries(groups: readonly IMenuEntryGroup[]): MenuEntry[] {
    const rest = groups.map((group) =>
        group.group === NAVIGATION_GROUP
            ? { group: group.group, entries: group.entries.filter((entry) => !isInlineItem(entry)) }
            : group,
    );
    return joinMenuGroups(rest.filter((group) => group.entries.length > 0));
}

/** Клик по inline-кнопке исполняет тот же пункт, что нарисовал кнопку. */
function runAction(groups: readonly IMenuEntryGroup[], actionId: string): void {
    for (const group of groups) {
        for (const entry of group.entries) {
            if (isInlineItem(entry) && entry.id === actionId) {
                entry.onSelect?.();
                return;
            }
        }
    }
}

function isInlineItem(entry: MenuEntry): entry is MenuItemEntry & { id: string; icon: string } {
    return entry.type === undefined && typeof entry.id === "string" && typeof entry.icon === "string";
}

/**
 * Пустое состояние секции: строка-подсказка без собственных отступов (аналог
 * viewsWelcome). Отступы даёт место: в панели контент и так начинается со
 * второй колонки под таб-строкой, а лишняя колонка обрезала бы подсказку на
 * узкой панели.
 */
function createViewPlaceholder(text: string): TUIElement {
    const label = new TextLabelElement(text);
    label.style = { fg: "descriptionForeground" };
    return label;
}
