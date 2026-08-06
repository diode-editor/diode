import type { TUIElement } from "../../../../../../tuidom/dom/tuiElement.ts";
import { TitledPanelElement } from "../../../../../../tuidom/ui/titledpanel/titledPanelElement.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { ContextMenuServiceDIToken } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IStateService } from "../../../../platform/state/common/iStateService.ts";
import type { ViewMenuContext } from "../../actions/menuContexts.ts";
import { StateServiceDIToken } from "../../../common/coreTokens.ts";
import { SIDEBAR_VIEWS_STATE, type IViewContainerViewsState } from "../../../common/stateKeys.ts";
import type { SidebarService } from "../sidebar/sidebarService.ts";
import { SidebarServiceDIToken } from "../sidebar/sidebarService.ts";

import { PaneViewElement } from "./paneViewElement.ts";

export const ViewsServiceDIToken = token<ViewsService>("ViewsService");

/** Контейнер view-секций = вьюлет сайдбара, разбитый на секции. */
export interface IViewContainerDescriptor {
    /** Id вьюлета сайдбара (например `"scm"` — см. `SCM_VIEWLET_ID`). */
    readonly id: string;
    /**
     * Заголовок рамки вьюлета (например `"  SOURCE CONTROL"`); для merged
     * контейнера — заголовок единственной секции без ведущих пробелов
     * (`"SEARCH"`, отступ рисует PaneHeaderElement).
     */
    readonly title: string;
    /**
     * Контейнер ровно одной view: заголовок секции сливается с заголовком
     * контейнера (как в VS Code) — без рамки TitledPanelElement, единственная
     * секция несворачиваемая, её заголовок несёт название контейнера и «⋯».
     * Вторая view в таком контейнере — ошибка.
     */
    readonly mergeSingleView?: boolean;
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
    readonly body: TUIElement;
    /** Отдать фокус содержимому view (команда показа, reveal вьюлета). */
    readonly focus: () => void;
    readonly minBodyHeight?: number;
}

interface ContainerEntry {
    /** null — контейнер ещё не зарегистрирован (в него только записались view). */
    descriptor: IViewContainerDescriptor | null;
    readonly views: IViewDescriptor[];
    /** Появляются в {@link ViewsService.attachContainer}. */
    paneView: PaneViewElement | null;
    /** TitledPanelElement для обычного контейнера, сам PaneViewElement для merged. */
    view: TUIElement | null;
}

/**
 * Реестр view-секций сайдбара и сборщик контейнеров (лайт-аналог
 * `IViewsService`/`ViewContainerRegistry` VS Code). Компоненты регистрируют
 * свои view декларативно ({@link registerView}), workbench собирает контейнер
 * ({@link attachContainer}): `TitledPanelElement(title, PaneViewElement)` — и
 * отдаёт его в {@link SidebarService} тем же `registerViewlet`, что и
 * одно-view вьюлеты (Explorer/Search остаются на прежней схеме).
 *
 * Сервис же владеет обвязкой секций: персист свёрнутости/весов (write-through
 * по действию пользователя, restore — строго после `openWorkspace`) и меню «⋯»
 * (`MenuId.ViewMoreActions` с императивной фильтрацией по `menuContext.view`).
 */
export class ViewsService {
    public static dependencies = [SidebarServiceDIToken, ContextMenuServiceDIToken, StateServiceDIToken] as const;

    private readonly containers = new Map<string, ContainerEntry>();

    public constructor(
        private readonly sidebarService: SidebarService,
        private readonly contextMenuService: ContextMenuService,
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
        entry.views.push(descriptor);
        entry.views.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
        if (entry.paneView !== null) {
            this.rebuildPanes(entry);
        }
    }

    /**
     * Строит контрол контейнера и регистрирует его вьюлетом сайдбара.
     * Зовётся из `WorkbenchComponent.setWorkspaceFolder` — рядом с
     * `registerViewlet` одно-view вьюлетов.
     */
    public attachContainer(containerId: string): void {
        const entry = this.containerOrThrow(containerId);
        if (entry.descriptor === null) {
            throw new Error(`ViewsService: container "${containerId}" is not registered`);
        }
        const title = entry.descriptor.title;
        if (entry.view !== null) return;
        const paneView = new PaneViewElement();
        paneView.id = `viewContainer-${containerId}`;
        paneView.onDidChangeState = () => this.persistContainerState(containerId, paneView);
        paneView.onDidRequestPaneMenu = (paneId, anchor) => {
            const context: ViewMenuContext = { view: paneId };
            this.contextMenuService.showContextMenu({
                getOwner: () => paneView,
                getAnchor: () => anchor,
                menuId: MenuId.ViewMoreActions,
                menuContext: context,
            });
        };
        entry.paneView = paneView;
        if (entry.descriptor.mergeSingleView === true) {
            // Merged: рамки нет, заголовок единственной секции — заголовок
            // контейнера. Цвета сайдбара — на самом paneView (обычно их несёт
            // TitledPanelElement).
            paneView.style = { fg: "sideBar.foreground", bg: "sideBar.background" };
            entry.view = paneView;
        } else {
            const framed = new TitledPanelElement(title, paneView);
            framed.style = { fg: "sideBar.foreground", bg: "sideBar.background" };
            entry.view = framed;
        }
        this.rebuildPanes(entry);
        this.sidebarService.registerViewlet(containerId, entry.view, () => {
            this.focusContainer(containerId);
        });
    }

    /**
     * Применяет свёрнутость/веса из workspace-стора ко всем построенным
     * контейнерам. Строго после `openWorkspace` (как `restoreViewMode`),
     * иначе прочитается global-стор. Без write-through.
     */
    public restoreViewsState(): void {
        const stored = this.stateService.get(SIDEBAR_VIEWS_STATE);
        for (const [containerId, entry] of this.containers) {
            const paneView = entry.paneView;
            const state = stored[containerId];
            if (paneView === null || state === undefined) continue;
            paneView.setWeights(state.weights);
            for (const paneId of paneView.getPaneIds()) {
                paneView.setCollapsed(paneId, state.collapsed.includes(paneId));
            }
        }
    }

    /** Фокус первой развёрнутой view контейнера (reveal вьюлета, команды показа). */
    public focusContainer(containerId: string): void {
        const entry = this.containerOrThrow(containerId);
        const paneView = entry.paneView;
        if (paneView === null) return;
        const target = entry.views.find((v) => !paneView.isCollapsed(v.id)) ?? entry.views[0];
        target?.focus();
    }

    private containerOrThrow(id: string): ContainerEntry {
        const entry = this.containers.get(id);
        if (entry === undefined) throw new Error(`ViewsService: unknown container id "${id}"`);
        return entry;
    }

    private ensureEntry(containerId: string): ContainerEntry {
        let entry = this.containers.get(containerId);
        if (entry === undefined) {
            entry = { descriptor: null, views: [], paneView: null, view: null };
            this.containers.set(containerId, entry);
        }
        return entry;
    }

    /** Пересобирает секции по реестру (первый build и поздняя регистрация). */
    private rebuildPanes(entry: ContainerEntry): void {
        const paneView = entry.paneView!;
        const merged = entry.descriptor?.mergeSingleView === true;
        if (merged && entry.views.length !== 1) {
            throw new Error(
                `ViewsService: merged container "${entry.descriptor!.id}" must have exactly one view, ` +
                    `got ${String(entry.views.length)}`,
            );
        }
        for (const paneId of [...paneView.getPaneIds()]) {
            paneView.removePane(paneId);
        }
        for (const view of entry.views) {
            paneView.addPane({
                id: view.id,
                // Merged: единственная секция носит заголовок контейнера и не
                // сворачивается — её заголовок и есть заголовок вьюлета.
                title: merged ? entry.descriptor!.title : view.title,
                body: view.body,
                minBodyHeight: view.minBodyHeight,
                collapsible: !merged,
            });
        }
    }

    /** Write-through по действию пользователя (toggle секции, drag границы). */
    private persistContainerState(containerId: string, paneView: PaneViewElement): void {
        const state: IViewContainerViewsState = {
            collapsed: paneView.getPaneIds().filter((id) => paneView.isCollapsed(id)),
            weights: paneView.getWeights(),
        };
        this.stateService.store(SIDEBAR_VIEWS_STATE, {
            ...this.stateService.get(SIDEBAR_VIEWS_STATE),
            [containerId]: state,
        });
    }
}
