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

import { PaneViewElement } from "./paneViewElement.ts";
import { inlineActions, isSelectionSubmenu, NAVIGATION_GROUP, overflowEntries, runAction } from "./titleMenuEntries.ts";
import { ViewContainerHeaderElement } from "./viewContainerHeaderElement.ts";
import type { IViewTitleAction } from "./viewTitleRowElement.ts";
import type { IViewWelcomeBlock } from "./viewWelcomeElement.ts";
import { ViewWelcomeElement } from "./viewWelcomeElement.ts";

export const ViewsServiceDIToken = token<ViewsService>("ViewsService");

const VIEWS_SUBMENU_LABEL = "Views";

/** Строки — те же, что отдаёт `ViewContainerLocationToString` эталона. */
export type ViewContainerLocation = "sidebar" | "panel" | "auxiliarybar";

export interface IViewContainerDescriptor {
    readonly id: string;
    /** Без ведущих пробелов (`"SOURCE CONTROL"`): отступ рисует заголовок. */
    readonly title: string;
    readonly location: ViewContainerLocation;
    /** Меньше — раньше; без него — после всех упорядоченных. */
    readonly order?: number;
    readonly isDefault?: boolean;
    /** Только для `location: "sidebar"`; выставляет {@link SidebarService}. */
    readonly visibleContextKey?: BooleanContextKey;
    readonly rejectAddedViews?: boolean;
}

export interface IViewDescriptor {
    readonly id: string;
    readonly containerId: string;
    /** КАПСОМ, как в VS Code (`"CHANGES"`). */
    readonly title: string;
    /** Меньше — выше. */
    readonly order: number;
    /** `null` — рисуется {@link placeholder}. */
    readonly body: TUIElement | null;
    /**
     * Строка-подсказка либо блоки текста и кнопок (аналог `viewsWelcome`). Рисуется,
     * пока `body === null` или секция погашена {@link requiresWorkspaceFolder}.
     */
    readonly placeholder?: string | readonly IViewWelcomeBlock[];
    /**
     * Без открытой папки рисуется {@link placeholder}, даже если тело построено (как
     * `when: workbenchState == empty` у `viewsWelcome` эталона): Search и SCM строят тело
     * заранее и без папки показывали бы рабочий с виду интерфейс, который молча ничего не делает.
     */
    readonly requiresWorkspaceFolder?: boolean;
    readonly focus: () => void;
    readonly minBodyHeight?: number;
    /** `false` — секцию нельзя скрыть через «⋯» контейнера (по умолчанию `true`). */
    readonly canToggleVisibility?: boolean;
    /** Только начальное состояние: сохранённую свёрнутость пользователя не перебивает. */
    readonly collapsed?: boolean;
    readonly canMoveView?: boolean;
}

export interface IViewContainerSnapshot {
    readonly id: string;
    readonly title: string;
    readonly location: ViewContainerLocation;
    /** Видимые секции в порядке показа. */
    readonly views: readonly IViewSnapshot[];
    readonly rejectAddedViews: boolean;
}

/** Как у эталона (`viewDescriptorService.ts`). */
const GENERATED_CONTAINER_PREFIX = "workbench.views.service.";

/** Подписи эталона (`paneCompositeBar.ts`). */
const MOVE_TO_LABEL = "Move To";
const RESET_LOCATION_LABEL = "Reset Location";
/** Порядок пунктов «Move To» у эталона: Sidebar, AuxiliaryBar, Panel. */
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
    // Корень ищем по пути, а не через getRoot(): у overlay-слоя свой корень.
    const path = element.getAncestorPath();
    const body = path.find((node) => node instanceof BodyElement);
    return body !== undefined && path.includes(body.getOverlayLayer());
}

/** Место зашито в id сгенерированного контейнера; у прочих — `null`. */
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

/** Изменяемая запись реестра: тело и виджет заголовка живут дольше дескриптора. */
interface ViewRecord {
    readonly id: string;
    /** Контейнер, где вид стоит сейчас (меняют переносы). */
    containerId: string;
    readonly defaultContainerId: string;
    readonly canMoveView: boolean;
    readonly title: string;
    readonly order: number;
    readonly focus: () => void;
    readonly minBodyHeight: number | undefined;
    readonly placeholder: string | readonly IViewWelcomeBlock[] | undefined;
    readonly requiresWorkspaceFolder: boolean;
    readonly canToggleVisibility: boolean;
    readonly collapsed: boolean;
    body: TUIElement | null;
    titleWidget: TUIElement | null;
    /** Живёт в записи, чтобы пережить пересборку секций. */
    spinner: string | null;
    placeholderView: TUIElement | null;
}

interface ContainerEntry {
    /** null — контейнер ещё не зарегистрирован (в него только записались view). */
    descriptor: IViewContainerDescriptor | null;
    location: ViewContainerLocation;
    /**
     * Контейнер просили показать: он стоит в своей части, пока в нём есть хоть один
     * вид, и возвращается туда, когда вид в него вернётся.
     */
    wanted: boolean;
    /** Контейнер создан переносом вида (`workbench.views.service.<место>.<uuid>`). */
    generated: boolean;
    readonly views: ViewRecord[];
    readonly hidden: Set<string>;
    paneView: PaneViewElement | null;
    header: ViewContainerHeaderElement | null;
    /**
     * «Заголовок + секции» сайдбара. Стабильна: merged-режим меняет НАБОР детей, иначе
     * место держало бы устаревший корень. В панели стопки нет — заголовок живёт в таб-строке.
     */
    stack: VFlexElement | null;
    /** Что отдано месту (стопка в сайдбаре, сам PaneView в панели); null — не приаттачен. */
    view: TUIElement | null;
    /** Кнопки заголовков не пересчитаны, пока контейнер был скрыт; досчитает показ. */
    titleActionsStale: boolean;
}

/**
 * После {@link ViewsService.attachContainer} дескриптор, PaneView и заголовок появляются
 * РАЗОМ и дальше не исчезают.
 */
type AttachedEntry = ContainerEntry & {
    descriptor: IViewContainerDescriptor;
    paneView: PaneViewElement;
    header: ViewContainerHeaderElement;
};

/** Зарегистрированный, но, может быть, ещё не построенный. */
type AttachedEntryDescriptor = ContainerEntry & { descriptor: IViewContainerDescriptor };

function attached(entry: ContainerEntry): AttachedEntry {
    return entry as AttachedEntry;
}

function orderOf(descriptor: IViewContainerDescriptor): number {
    return descriptor.order ?? Number.POSITIVE_INFINITY;
}

/** Контейнер не на своём месте встаёт в конец (как у эталона), на своём — по `order`. */
function placementOrder(entry: AttachedEntryDescriptor): number {
    return entry.location === entry.descriptor.location ? orderOf(entry.descriptor) : Number.POSITIVE_INFINITY;
}

export interface IViewExpandedChangeEvent {
    readonly viewId: string;
    readonly expanded: boolean;
}

/**
 * Реестр view-секций и сборщик контейнеров (лайт-аналог `IViewsService`/`ViewContainerRegistry`).
 * Merged-режим выводится, а не объявляется: контейнер с ровно одной ВИДИМОЙ view рисуется
 * без рамки, а её заголовок несёт название контейнера и не сворачивается.
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
    ] as const;

    private readonly containers = new Map<string, ContainerEntry>();
    /** База для диффа {@link syncExpanded}; нет ключа — `false`. */
    private readonly expandedState = new Map<string, boolean>();
    private readonly onDidChangeViewExpandedEmitter = new Emitter<IViewExpandedChangeEvent>();
    private readonly onDidChangeLocationsEmitter = new Emitter<void>();
    private readonly onDidActivateViewEmitter = new Emitter<string>();
    private readonly onDidShowViewEmitter = new Emitter<string>();
    /** Переносы из стора уже применены (после этого поздние виды встают по ним сами). */
    private customizationsApplied = false;
    /** Идёт рестор или сброс переносов: стор не пишется, это не действие пользователя. */
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
    ) {
        // Сервис — синглтон окна: снимать подписку некому.
        workspaceContext.onDidChangeWorkspaceFolders(() => {
            this.refreshWorkspaceGatedViews();
        });
        // На бутстрапе состояние применяет mount(), строя контейнеры; здесь — Open Folder
        // на уже собранном сайдбаре.
        stateService.onDidOpenWorkspace(() => {
            // Сначала места, потом состояние секций.
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
     * Порядок свободный: DI создаёт компоненты раньше, чем workbench регистрирует контейнеры.
     * Повторная регистрация id заменяет запись, поздняя — пересобирает секции.
     */
    public registerView(descriptor: IViewDescriptor): void {
        // Повторная регистрация заменяет запись там, где вид стоит сейчас: перенос
        // пользователя её переживает.
        const previous = this.findRecord(descriptor.id);
        const entry = previous?.entry ?? this.ensureEntry(descriptor.containerId);
        const existing = entry.views.findIndex((v) => v.id === descriptor.id);
        if (existing >= 0) {
            entry.views.splice(existing, 1);
        }
        entry.views.push({
            id: descriptor.id,
            containerId: previous?.record.containerId ?? descriptor.containerId,
            defaultContainerId: descriptor.containerId,
            canMoveView: descriptor.canMoveView ?? false,
            title: descriptor.title,
            order: descriptor.order,
            focus: descriptor.focus,
            minBodyHeight: descriptor.minBodyHeight,
            placeholder: descriptor.placeholder,
            requiresWorkspaceFolder: descriptor.requiresWorkspaceFolder ?? false,
            canToggleVisibility: descriptor.canToggleVisibility ?? true,
            collapsed: descriptor.collapsed ?? false,
            body: descriptor.body,
            titleWidget: null,
            spinner: null,
            placeholderView: null,
        });
        entry.views.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
        // Вид после рестора переносов встаёт туда, куда его перенесли в прошлый раз.
        // Stryker disable next-line ConditionalExpression,LogicalOperator: повторная регистрация и вид до рестора встали бы туда же — стор переносов и так совпадает с текущим местом, а рестор расставит ранние виды сам
        if (previous === undefined && this.customizationsApplied) {
            const target: unknown = this.stateService.get(VIEWS_CUSTOMIZATIONS_STATE).viewLocations[descriptor.id];
            if (typeof target === "string") this.placeStoredView(descriptor.id, target);
        }
        // Вид мог уехать — тогда сборка контейнера по умолчанию его отпускает.
        this.syncPresence(entry);
    }

    /** `null` — вернуться к пустому состоянию; свёрнутость и вес сохраняются. */
    public setViewBody(viewId: string, body: TUIElement | null): void {
        const { entry, record } = this.recordOrThrow(viewId);
        if (record.body === body) return;
        record.body = body;
        if (entry.paneView === null || entry.hidden.has(viewId)) return;
        entry.paneView.setPaneBody(viewId, this.bodyOf(record));
    }

    /** Escape-hatch для контролов, не выражаемых пунктом меню (каналы Output). */
    public setViewTitleWidget(viewId: string, widget: TUIElement | null): void {
        const { entry, record } = this.recordOrThrow(viewId);
        if (record.titleWidget === widget) return;
        record.titleWidget = widget;
        if (entry.paneView === null || entry.hidden.has(viewId)) return;
        this.refreshContainerTitleActions(entry);
    }

    /**
     * Тик кадра (10 Гц) идёт этим коротким путём, а не через `refreshContainerTitleActions`
     * (резолв меню каждой секции). Незарегистрированная view — молчаливый no-op.
     */
    public setViewSpinner(viewId: string, frame: string | null): void {
        const found = this.findRecord(viewId);
        if (found === undefined) return;
        const { entry, record } = found;
        // Состав полосы контролов таб-строки меняют только появление и уход спиннера.
        // Stryker disable next-line ConditionalExpression: пересчёт идемпотентен, поэтому лишний вызов виден только по стоимости; пропуск нужного закрыт тестом появления и ухода полосы
        const appeared = (record.spinner === null) !== (frame === null);
        record.spinner = frame;
        if (entry.paneView === null || entry.hidden.has(viewId)) return;
        this.applySpinner(entry, record);
        // Stryker disable next-line ConditionalExpression,LogicalOperator: та же причина, что строкой выше — лишний пересчёт ненаблюдаем
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

    /** Контейнер собран, секция не скрыта и не свёрнута; merged-секция раскрыта всегда. */
    public isViewExpanded(viewId: string): boolean {
        const { entry } = this.recordOrThrow(viewId);
        if (entry.paneView === null || entry.hidden.has(viewId)) return false;
        return !entry.paneView.isCollapsed(viewId);
    }

    /**
     * Диффит сам сервис, а не {@link PaneViewElement}: тот пересоздаёт панели и молча
     * игнорирует свёртку merged-секции, так что пер-панельное событие теряло бы переходы.
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

    /** Последнюю видимую секцию скрыть нельзя, как в VS Code. */
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
     * Единственная точка сборки контейнеров. Видимость сайдбара не трогает — её
     * восстанавливает персист layout'а.
     */
    public attachRegisteredContainers(): void {
        // Переносы — до сборки: контейнер сразу строится на своём месте.
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
     * `orFirst` — если дефолтного в сайдбаре нет (перенесён или пуст), показать первый.
     * Видимость сайдбара не трогает.
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
     * Контейнер без единого вида места не занимает (как у эталона) и встаёт туда сам,
     * когда в него придёт вид.
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
        // Точки в id контейнера меняем на дефисы: селекторы инспектора/e2e их не
        // поддерживают (`workbench.panel.output` → `#viewContainer-workbench-panel-output`).
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
        paneView.onDidRequestPaneAction = (paneId, actionId) => {
            runAction(this.viewTitleGroups(paneId), actionId);
        };
        entry.paneView = paneView;
        // В панели (и во вторичной панели) заголовка-строки нет — та же строка
        // заголовка работает полосой контролов в таб-строке, поэтому названия не несёт.
        const tabbed = this.isTabbed(entry);
        const header = new ViewContainerHeaderElement(tabbed ? "" : containerTitle(entry));
        header.id = `viewContainerHeader-${domId}`;
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
        if (tabbed) {
            // Позиция считается ДО того, как контейнер станет приаттаченным:
            // сам себя он не считает.
            const index = this.tabIndexOf(entry);
            entry.view = paneView;
            // Вкладку заводим ДО сборки секций: полоса контролов таб-строки
            // ставится через реестр части, а он игнорирует незнакомый id.
            this.partOf(entry).addView({ id: containerId, title: containerTitle(entry), content: paneView, index });
            this.rebuildPanes(entry);
            // Первая вкладка части становится активной молча (без события смены) —
            // о показе её видов сообщаем сами.
            if (this.partOf(entry).getActiveViewId() === containerId)
                this.fireContainerEvent(containerId, this.onDidShowViewEmitter);
            return;
        }
        const stack = new VFlexElement();
        // Стабильный селектор места для e2e/инспектора (`#explorer`, `#scm`).
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

    private tabIndexOf(target: AttachedEntryDescriptor): number {
        let index = 0;
        for (const entry of this.containers.values()) {
            if (entry.view === null || entry.location !== target.location) continue;
            if (placementOrder(entry as AttachedEntryDescriptor) <= placementOrder(target)) index++;
        }
        return index;
    }

    /**
     * Строго после `openWorkspace`, иначе прочитается стор пустого окна. Без write-through.
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
        // Скрытость применяем до весов: она пересобирает секции, а
        // единственная оставшаяся видимой секция становится merged.
        // Stryker disable next-line ArrayDeclaration: незнакомый id в списке скрытых пропускается ниже — мусорный элемент ненаблюдаем
        const hidden = state.hidden ?? [];
        entry.hidden.clear();
        for (const viewId of hidden) {
            const record = entry.views.find((v) => v.id === viewId);
            if (record?.canToggleVisibility === true) entry.hidden.add(viewId);
        }
        // Протухший стор, где скрыто всё, чиним молча; без видов собранного контейнера
        // не бывает (syncPresence его снимает).
        if (entry.hidden.size === entry.views.length) {
            entry.hidden.delete(entry.views[0].id);
        }
        this.rebuildPanes(entry);
        paneView.setWeights(state.weights);
        for (const paneId of paneView.getPaneIds()) {
            const collapsed = storedCollapsed(state.collapsed, paneId);
            // Стор про секцию не знает — остаётся дефолт дескриптора.
            if (collapsed !== undefined) paneView.setCollapsed(paneId, collapsed);
        }
        // Программный путь `setCollapsed` не зовёт `onDidChangeState` —
        // о восстановленной свёрнутости подписчиков извещаем сами.
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

    /** Стоящие на своих местах (зарегистрированы и не пусты) — по местам и `order`. */
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
                location: entry.location,
                views: this.getContainerViews(entry.descriptor.id).filter((view) => view.visible),
                rejectAddedViews: entry.descriptor.rejectAddedViews === true,
            }));
    }

    /** В НОВЫЙ контейнер на месте `location`; непереносимый вид — no-op. */
    public moveViewToLocation(viewId: string, location: ViewContainerLocation): void {
        // Непереносимый вид перенос пропустит, а пустой новый контейнер удалит.
        const target = this.createGeneratedContainer(location);
        this.moveViewsToContainer([viewId], target.descriptor.id);
    }

    /**
     * Опустевший контейнер уходит со своего места, а сгенерированный — исчезает вовсе.
     * Непереносимые виды и контейнер, отвергающий чужие виды, пропускаются.
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
        // Сначала цель (вкладка появляется), потом источники (опустевшие уходят).
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
        // Вид, уже стоящий дома, перенос в свой же контейнер пропустит сам.
        const found = this.findRecord(viewId);
        if (found !== undefined) this.moveViewsToContainer([viewId], found.record.defaultContainerId);
    }

    public resetViewContainerLocation(containerId: string): void {
        const location = this.getDefaultViewContainerLocation(containerId);
        // Stryker disable next-line ConditionalExpression: у незнакомого контейнера места нет, и перенос его пропустит сам — охрана только ради типа
        if (location !== null) this.moveViewContainerToLocation(containerId, location);
    }

    public resetViewLocations(): void {
        this.resetLocations();
        this.didChangeLocations();
    }

    /** Вид или контейнер сменил место (перенос, reset, рестор переносов проекта). */
    public readonly onDidChangeLocations = this.onDidChangeLocationsEmitter.event;

    /**
     * Вкладку части активирует как пользователь (ленивые фичи просыпаются) и показывает
     * часть; вьюлет — показывает в сайдбаре.
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
        // У сайдбара показ и фокус — один шаг (`showViewlet` с reveal).
        this.sidebarService.showViewlet(containerId, true);
    }

    /**
     * Скрытую секцию раскрывает. `activate: false` — показ программный: ленивые фичи (спавн
     * шелла) не будятся; так показывают вид команды, которые сами решают, что в нём создать.
     */
    public openView(viewId: string, focus = false, activate = true): void {
        const found = this.findRecord(viewId);
        if (found?.entry.view == null) return;
        // Видимую секцию setViewVisible не трогает.
        this.setViewVisible(viewId, true);
        if (activate || !this.isTabbed(found.entry)) {
            this.openViewContainer(found.record.containerId, false);
        } else {
            const part = this.partOf(found.entry);
            part.setActiveView(found.record.containerId);
            part.setVisible(true);
        }
        if (!focus) return;
        const body = this.bodyOf(found.record);
        if (body instanceof ViewWelcomeElement && body.focusFirstButton()) return;
        found.record.focus();
    }

    /**
     * `isViewVisible` эталона: контейнер активен в части, часть видна, секция не скрыта.
     * Наш `isViewVisible` — про скрытость секции, отсюда своё имя.
     */
    public isViewShown(viewId: string): boolean {
        const found = this.findRecord(viewId);
        if (found?.entry.view == null || found.entry.hidden.has(viewId)) return false;
        const containerId = found.record.containerId;
        if (!this.isTabbed(found.entry)) return this.sidebarService.isViewletVisible(containerId);
        const part = this.partOf(found.entry);
        return part.visible && part.getActiveViewId() === containerId;
    }

    /** Прячет часть, если контейнер вида в ней активен; вид в фоне части её не трогает. */
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

    /** Пользователь активировал вид — здесь просыпаются ленивые фичи (шелл терминала). */
    public readonly onDidActivateView = this.onDidActivateViewEmitter.event;

    /** Вид стал активным в части — и пользователем, и программно (рестор, перенос). */
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
            // Stryker disable next-line ConditionalExpression,LogicalOperator: отсев контейнера целиком — только ускорение: тело вида вне его PaneView на пути фокуса не стоит
            if (entry.paneView === null || !path.includes(entry.paneView)) continue;
            for (const record of entry.views) {
                const body = record.body ?? record.placeholderView;
                if (body !== null && path.includes(body)) return record.id;
            }
        }
        return null;
    }

    /**
     * `focusedView`. Фокус в оверлее вид не отменяет: «Move Focused View» из палитры должен
     * видеть вид, из которого палитру открыли (у эталона команда исполняется с фокусом на виде).
     */
    public updateContextKeys(contextKeys: ContextKeyService, active: TUIElement | null): void {
        // `null` — тоже не уход из вида: так выглядит промежуток между blur
        // вида и focus поля палитры.
        if (active === null || isInOverlay(active)) return;
        contextKeys.set("focusedView", this.getFocusedViewId(active) ?? "");
    }

    /**
     * Как `getContextMenuActionsForComposite` эталона: места в порядке Primary Side Bar,
     * Secondary Side Bar, Panel без текущего.
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

    /** «Reset Location»: контейнер не на своём месте — вернуть его; сгенерированный с одним видом — вернуть вид. */
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

    /** Переставить запись вида в другой контейнер (сборку мест делает {@link syncPresence}). */
    private moveRecord(found: { entry: ContainerEntry; record: ViewRecord }, target: ContainerEntry): void {
        const { entry: source, record } = found;
        source.views.splice(source.views.indexOf(record), 1);
        source.hidden.delete(record.id);
        // Скрытыми все оставшиеся секции быть не могут (см. setViewVisible).
        if (source.views.length > 0 && source.hidden.size === source.views.length) {
            source.hidden.delete(source.views[0].id);
        }
        record.containerId = attached(target).descriptor.id;
        target.views.push(record);
        target.views.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    }

    private setContainerLocation(entry: ContainerEntry, location: ViewContainerLocation): void {
        // Снять с прежнего места — пока `location` ещё прежнее.
        if (entry.view !== null) this.detachContainer(entry);
        entry.location = location;
        this.syncPresence(entry);
    }

    private createGeneratedContainer(
        location: ViewContainerLocation,
        id = `${GENERATED_CONTAINER_PREFIX}${location}.${generateUuid()}`,
    ): AttachedEntryDescriptor {
        // Stryker disable next-line StringLiteral: название сгенерированного не читается — его носит первый вид (containerTitle)
        this.registerContainer({ id, title: "", location });
        const entry = this.containerOrThrow(id) as AttachedEntryDescriptor;
        entry.generated = true;
        entry.wanted = true;
        return entry;
    }

    /** С видами — построен, без видов — снят, сгенерированный без видов — удалён. */
    private syncPresence(entry: ContainerEntry): void {
        if (entry.paneView !== null && entry.views.length > 0) {
            this.rebuildPanes(entry);
            return;
        }
        // Stryker disable next-line ConditionalExpression: `wanted` ставят только attachContainer и createGeneratedContainer, оба — с дескриптором; проверка на null — ради типа
        if (entry.descriptor === null || !entry.wanted) return;
        if (entry.views.length === 0) {
            if (entry.view !== null) this.detachContainer(entry);
            if (entry.generated) this.disposeGeneratedContainer(entry.descriptor.id);
            return;
        }
        this.buildContainer(entry as AttachedEntryDescriptor);
        this.restoreContainerState(entry);
    }

    /** Тела видов отцепляются и ждут новой сборки. */
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

    /** Только отличия от дефолта — как `saveViewCustomizations` эталона. */
    private saveCustomizations(): void {
        // Stryker disable next-line ConditionalExpression: рестор и сброс переносов сюда не ходят (они без didChangeLocations) — охрана на случай подписчика, который двинет вид из onDidChangeLocations
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
        // Stryker disable next-line BooleanLiteral: рестор только расставляет виды по сгенерированным, а не опустошает их — стор под флагом здесь не пишется; флаг ради сброса в reapplyStoredCustomizations
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

    /** Сгенерированный контейнер создаёт; поставить некуда — вид остаётся дома. */
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
        // Stryker disable next-line ConditionalExpression: в стор попадают только виды не в своём контейнере, а новый вид стоит в своём — «→ true» переставил бы запись на то же место
        if (found.entry !== target) {
            this.moveRecord(found, target);
            this.syncPresence(found.entry);
        }
        this.syncPresence(target);
    }

    private reapplyStoredCustomizations(): void {
        if (!this.customizationsApplied) return;
        // Флаг снимает applyStoredCustomizations — сброс идёт под ним же.
        this.applyingCustomizations = true;
        this.resetLocations();
        this.applyStoredCustomizations();
        this.onDidChangeLocationsEmitter.fire();
    }

    /** Фокус первой развёрнутой видимой view контейнера (reveal, команды показа). */
    public focusContainer(containerId: string): void {
        const entry = this.containerOrThrow(containerId);
        const paneView = entry.paneView;
        if (paneView === null) return;
        const visible = this.visibleViews(entry);
        const target = visible.find((v) => !paneView.isCollapsed(v.id)) ?? visible.at(0);
        if (target === undefined) return;
        // Пустое состояние на экране — фокус в него: из «папка не открыта» выход —
        // одним Enter по кнопке welcome, а не Tab'ами из невидимого инпута.
        const body = this.bodyOf(target);
        if (body instanceof ViewWelcomeElement && body.focusFirstButton()) return;
        target.focus();
    }

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

    /** Свой заголовок есть только у не-merged (2+ секций), значит переключатель здесь всегда. */
    private containerMenuEntries(entry: ContainerEntry): MenuEntry[] {
        const entries = overflowEntries(this.containerTitleGroups(attached(entry).descriptor.id));
        const views = this.buildViewsSubmenu(entry);
        const own: MenuEntry[] = entries.length > 0 ? [...entries, { type: "separator" }, views] : [views];
        return [...own, ...this.sidebarLocationEntries(entry)];
    }

    /**
     * Отступление: у эталона «Move To» — контекстное меню иконки activity bar, которого у
     * нас нет. Вкладки частей несут его в своём меню ({@link showTabContextMenu}).
     */
    private sidebarLocationEntries(entry: ContainerEntry): MenuEntry[] {
        if (this.isTabbed(entry)) return [];
        return [{ type: "separator" }, ...this.locationMenuEntries(entry)];
    }

    /**
     * У merged своего заголовка нет: его команды (включая inline-группу — рисовать её негде)
     * и переключатель секций живут в «⋯» единственной секции.
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

    /** Пункты динамические, в реестре меню их нет — поэтому здесь, а не контрибуцией. */
    private viewsSubmenu(entry: ContainerEntry): MenuSubmenuEntry | null {
        if (entry.views.length < 2) return null;
        return this.buildViewsSubmenu(entry);
    }

    /** Само подменю, без условия «секций 2+» — для мест, где оно заведомо есть. */
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
     * В панели у merged роль заголовка играет таб, поэтому полоса контролов таб-строки
     * несёт действия ЕДИНСТВЕННОЙ секции (как в VS Code).
     */
    private headerTargetView(entry: ContainerEntry): string | null {
        if (!this.isTabbed(entry) || !this.isMerged(entry)) return null;
        // merged — это ровно одна видимая секция, так что индекс 0 существует.
        return this.visibleViews(entry)[0].id;
    }

    private titleGroups(entry: ContainerEntry): IMenuEntryGroup[] {
        const viewId = this.headerTargetView(entry);
        return viewId === null
            ? this.containerTitleGroups(attached(entry).descriptor.id)
            : this.viewTitleGroups(viewId);
    }

    /**
     * Вопрос СТАТИЧЕСКИЙ, без `when`: ключи меняются без событий (`gitHasRepo`), а заголовок
     * пересобирается только со сменой состава секций — спроси «пусто ли сейчас», и кнопка
     * исчезла бы навсегда.
     */
    private hasOverflow(menuId: MenuId, context: unknown): boolean {
        // Пункт группы `navigation` с иконкой уезжает в кнопку, а submenu-выбор
        // той же группы — в виджет заголовка; ни тот, ни другой не в попапе.
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
        // Merged: в «⋯» уезжает подменю контейнера; у вьюлета сайдбара в нём всегда «Move To».
        if (!this.isTabbed(entry)) return true;
        const containerContext: ViewContainerMenuContext = { container: attached(entry).descriptor.id };
        return this.menuService.hasItems(MenuId.ViewContainerTitle, containerContext) || entry.views.length >= 2;
    }

    private titleMenuPossible(entry: ContainerEntry): boolean {
        const viewId = this.headerTargetView(entry);
        if (viewId !== null) return this.paneMenuPossible(entry, viewId);
        // Сюда доходят вьюлет сайдбара (в «⋯» всегда есть «Move To») и вкладка
        // не merged — у неё видимых секций не меньше двух, значит есть «Views».
        return true;
    }

    private titleMenuEntries(entry: ContainerEntry): MenuEntry[] {
        const viewId = this.headerTargetView(entry);
        return viewId === null ? this.containerMenuEntries(entry) : this.paneMenuEntries(entry, viewId);
    }

    /**
     * `when` и `enablement` пунктов зависят от контекст-ключей, а заголовок сам пересобирается
     * только со сменой состава секций.
     */
    public refreshTitleActions(): void {
        for (const entry of this.containers.values()) {
            if (entry.paneView === null) continue;
            this.refreshContainerTitleActions(entry);
        }
    }

    /**
     * Только у показанного контейнера, остальным — пометка: резолв меню — самая дорогая часть
     * сборки заголовка. Как у эталона: тулбар заголовка есть только у открытого композита.
     */
    private refreshContainerTitleActions(entry: ContainerEntry): void {
        const shown = this.isShown(entry);
        entry.titleActionsStale = !shown;
        const paneView = attached(entry).paneView;
        const headerViewId = this.headerTargetView(entry);
        for (const record of this.visibleViews(entry)) {
            if (shown) {
                paneView.setPaneActions(record.id, inlineActions(this.viewTitleGroups(record.id)));
                // «⋯», которая ничего не открывает, выглядит сломанной (так было у Explorer'а).
                paneView.setPaneMenuVisible(record.id, this.paneMenuPossible(entry, record.id));
            }
            // Виджет и спиннер ставятся и скрытому: в момент показа кадр уже должен стоять.
            // Виджет уехавшей в таб-строку секции забирает заголовок контейнера: родитель один.
            paneView.setPaneTitleWidget(record.id, record.id === headerViewId ? null : record.titleWidget);
            // Заголовки только что пересоздались — вернуть им кадр спиннера,
            // иначе операция, начатая до пересборки, теряет индикацию.
            this.applySpinner(entry, record);
        }
        if (!shown) return;
        // Заголовок создан в attachContainer до первой пересборки секций.
        const header = attached(entry).header;
        const actions = inlineActions(this.titleGroups(entry));
        header.setActions(actions);
        // Stryker disable next-line ConditionalExpression: у вьюлета сайдбара таб-строки нет — виджет у него null (headerTargetView), меню шапки 2+ секций видно и так, а partOf отдаёт panelService, который незнакомый id пропускает
        if (!this.isTabbed(entry)) return;
        const headerRecord = headerViewId === null ? null : this.recordOrThrow(headerViewId).record;
        const widget = headerRecord?.titleWidget ?? null;
        header.setTitleWidget(widget);
        const hasMenu = this.titleMenuPossible(entry);
        header.setMenuVisible(hasMenu);
        // Пустой полосе места в таб-строке не даём. Спиннер — тоже содержимое: иначе
        // прогресс секции панели было бы не видно.
        // Stryker disable next-line OptionalChaining: до этого операнда цепочка доходит только при `!hasMenu`, а он ложен ровно тогда, когда секций 2+ и headerRecord пуст — то есть здесь запись всегда есть
        const empty = actions.length === 0 && widget === null && !hasMenu && headerRecord?.spinner == null;
        this.partOf(entry).setViewActions(attached(entry).descriptor.id, empty ? null : header);
    }

    private refreshStaleTitleActions(containerId: string): void {
        const entry = this.containers.get(containerId);
        if (entry?.paneView == null || !entry.titleActionsStale) return;
        this.refreshContainerTitleActions(entry);
    }

    /**
     * Активный вьюлет сайдбара или активная вкладка панели. Видимость самой части не
     * учитывается: её смена (Ctrl+B, рестор layout'а) идёт мимо этих сервисов.
     */
    private isShown(entry: ContainerEntry): boolean {
        const id = attached(entry).descriptor.id;
        return this.isTabbed(entry)
            ? this.partOf(entry).getActiveViewId() === id
            : this.sidebarService.getActiveViewletId() === id;
    }

    /** У merged-секции панели роль заголовка играет полоса контролов таб-строки. */
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
                // Stryker disable next-line StringLiteral: место незарегистрированного контейнера не читается — registerContainer переписывает его дескриптором
                location: "sidebar",
                wanted: false,
                generated: false,
                views: [],
                hidden: new Set(),
                paneView: null,
                header: null,
                stack: null,
                view: null,
                // Stryker disable next-line BooleanLiteral: эквивалентный — до attachContainer показ упирается в `paneView === null`, а сам attach всегда пересобирает секции и переписывает флаг
                titleActionsStale: false,
            };
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

    /** Вкладка в таб-строке части (нижней или вторичной панели), а не вьюлет сайдбара. */
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

    /** Секция требует папку, а папки нет — на экране пустое состояние, не тело. */
    private isGatedOut(record: ViewRecord): boolean {
        return record.requiresWorkspaceFolder && this.workspaceContext.getWorkbenchState() === "empty";
    }

    private createPlaceholder(record: ViewRecord): TUIElement {
        const placeholder = record.placeholder;
        if (placeholder === undefined || typeof placeholder === "string") {
            return createViewPlaceholder(placeholder ?? "");
        }
        return new ViewWelcomeElement(placeholder, (command, args) => {
            this.commands.execute(command, ...args);
        });
    }

    /**
     * Пересборка секций не нужна: меняется только тело, а свёрнутость и веса обязаны
     * пережить открытие папки.
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

    /** Свёрнутость и веса переживают пересборку — иначе показ скрытой секции сбросил бы раскладку. */
    private rebuildPanes(entry: ContainerEntry): void {
        const paneView = attached(entry).paneView;
        // Секция, которой в контейнере ещё нет, встаёт по дефолту дескриптора.
        const previous = new Map(paneView.getPaneIds().map((id) => [id, paneView.isCollapsed(id)]));
        const weights = paneView.getWeights();
        for (const paneId of [...paneView.getPaneIds()]) {
            paneView.removePane(paneId);
        }
        const visible = this.visibleViews(entry);
        const merged = visible.length === 1;
        // В панели заголовок merged-секции — сам таб, поэтому строки под него нет.
        const headerVisible = !(merged && this.isTabbed(entry));
        for (const view of visible) {
            paneView.addPane({
                id: view.id,
                // Merged в сайдбаре: заголовок единственной секции и есть заголовок контейнера.
                title: merged && !this.isTabbed(entry) ? containerPaneTitle(entry) : view.title,
                body: this.bodyOf(view),
                minBodyHeight: view.minBodyHeight,
                collapsible: !merged,
                headerVisible,
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
            // Пишем ОБА состояния, а не только свёрнутые: развёрнутость — тоже
            // выбор пользователя, и она обязана перебивать дефолт дескриптора.
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
 * `undefined` — стор про секцию не знает, действует дефолт дескриптора. Стор прошлых версий
 * держал массив id свёрнутых: про неперечисленные ничего не известно.
 */
function storedCollapsed(stored: StoredCollapsed, viewId: string): boolean | undefined {
    if (isLegacyCollapsedList(stored)) return stored.includes(viewId) ? true : undefined;
    return stored[viewId];
}

type StoredCollapsed = IViewContainerViewsState["collapsed"];

function isLegacyCollapsedList(stored: StoredCollapsed): stored is readonly string[] {
    return Array.isArray(stored);
}

/** Ведущие пробелы старого формата срезаем — отступ рисует сам заголовок. */
function containerPaneTitle(entry: ContainerEntry): string {
    return containerTitle(entry).trimStart();
}

/**
 * У сгенерированного своего названия нет (у эталона — невидимая заглушка «User View
 * Container»), поэтому он носит название первого вида.
 */
function containerTitle(entry: ContainerEntry): string {
    // Stryker disable next-line OptionalChaining,StringLiteral: опустевший сгенерированный удаляется сразу (syncPresence) — без видов его название не спрашивают
    if (entry.generated) return entry.views.at(0)?.title ?? "";
    return attached(entry).descriptor.title;
}

/**
 * Без собственных отступов: их даёт место, а лишняя колонка обрезала бы подсказку на узкой
 * панели.
 */
function createViewPlaceholder(text: string): TUIElement {
    const label = new TextLabelElement(text);
    label.style = { fg: "descriptionForeground" };
    return label;
}
