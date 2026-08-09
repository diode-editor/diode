import type { TUIElement } from "../../../../../../tuidom/dom/tuiElement.ts";
import { PaddingContainerElement } from "../../../../../../tuidom/ui/layout/paddingContainerElement.ts";
import { VFlexElement, vflexFill, vflexFixed } from "../../../../../../tuidom/ui/layout/vFlexElement.ts";
import { TextLabelElement } from "../../../../../../tuidom/ui/text/textLabelElement.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { ContextMenuServiceDIToken } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IStateService } from "../../../../platform/state/common/iStateService.ts";
import type { ViewContainerMenuContext, ViewMenuContext } from "../../actions/menuContexts.ts";
import { StateServiceDIToken } from "../../../common/coreTokens.ts";
import { SIDEBAR_VIEWS_STATE, type IViewContainerViewsState } from "../../../common/stateKeys.ts";
import type { SidebarService } from "../sidebar/sidebarService.ts";
import { SidebarServiceDIToken } from "../sidebar/sidebarService.ts";

import { PaneViewElement } from "./paneViewElement.ts";
import { ViewContainerHeaderElement } from "./viewContainerHeaderElement.ts";

export const ViewsServiceDIToken = token<ViewsService>("ViewsService");

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
    view: VFlexElement | null;
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
 * `openWorkspace`) и меню «⋯» (`MenuId.ViewMoreActions` с императивной
 * фильтрацией по `menuContext.view`).
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
        this.recordOrThrow(viewId).record.titleWidget = widget;
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
            const context: ViewMenuContext = { view: paneId };
            this.contextMenuService.showContextMenu({
                getOwner: () => paneView,
                getAnchor: () => anchor,
                menuId: MenuId.ViewMoreActions,
                menuContext: context,
            });
        };
        entry.paneView = paneView;
        const header = new ViewContainerHeaderElement(entry.descriptor.title);
        header.id = `viewContainerHeader-${containerId.replaceAll(".", "-")}`;
        header.onMenu = (anchor) => {
            const context: ViewContainerMenuContext = { container: containerId };
            this.contextMenuService.showContextMenu({
                getOwner: () => header,
                getAnchor: () => anchor,
                menuId: MenuId.ViewContainerTitle,
                menuContext: context,
            });
        };
        entry.header = header;
        const root = new VFlexElement();
        root.id = `viewContainerRoot-${containerId.replaceAll(".", "-")}`;
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

    /**
     * Держит набор детей корня: merged-контейнер обходится без собственного
     * заголовка (его роль играет заголовок единственной секции).
     */
    private syncContainerFrame(entry: ContainerEntry): void {
        const root = entry.view;
        if (root === null) return;
        const paneView = entry.paneView!;
        const header = entry.header!;
        header.layoutStyle = { height: vflexFixed(1), width: "fill" };
        paneView.layoutStyle = { height: vflexFill(), width: "fill" };
        root.replaceChildren(this.isMerged(entry) ? [paneView] : [header, paneView]);
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
        for (const view of visible) {
            paneView.addPane({
                id: view.id,
                // Merged: единственная секция носит заголовок контейнера и не
                // сворачивается — её заголовок и есть заголовок контейнера.
                title: merged ? containerPaneTitle(entry) : view.title,
                body: this.bodyOf(view),
                minBodyHeight: view.minBodyHeight,
                collapsible: !merged,
            });
        }
        paneView.setWeights(weights);
        for (const view of visible) {
            paneView.setCollapsed(view.id, collapsed.has(view.id));
        }
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

/** Пустое состояние секции: строка-подсказка с отступом (аналог viewsWelcome). */
function createViewPlaceholder(text: string): TUIElement {
    const label = new TextLabelElement(text);
    label.style = { fg: "descriptionForeground" };
    return new PaddingContainerElement(label, { left: 1, top: 1, right: 1 });
}
