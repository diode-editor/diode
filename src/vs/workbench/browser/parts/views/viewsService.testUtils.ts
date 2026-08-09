import type { TUIElement } from "../../../../../../tuidom/dom/tuiElement.ts";
import { FillerElement } from "../../../../../../tuidom/ui/layout/fillerElement.ts";
import type { MenuContribution } from "../../../../platform/actions/common/iMenuContribution.ts";
import { MenuRegistry } from "../../../../platform/actions/common/menuRegistry.ts";
import { MenuService } from "../../../../platform/actions/common/menuService.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import type { IContextMenuDelegate } from "../../../../platform/contextview/common/contextMenuDelegate.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { IStateDescriptor, IStateService } from "../../../../platform/state/common/iStateService.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import type { IPanelView } from "../panel/panelService.ts";
import { PanelService } from "../panel/panelService.ts";
import type { SidebarService } from "../sidebar/sidebarService.ts";

import type { PaneViewElement } from "./paneViewElement.ts";
import type { ViewContainerHeaderElement } from "./viewContainerHeaderElement.ts";
import type { IViewDescriptor } from "./viewsService.ts";
import { ViewsService } from "./viewsService.ts";

/** Общий стенд тестов ViewsService: реальные реестры меню, фейки места и стора. */
export interface IViewsHarness {
    readonly service: ViewsService;
    /** Настоящий реестр вкладок нижней панели — для контейнеров location: "panel". */
    readonly panelService: PanelService;
    readonly menuService: MenuService;
    readonly commands: CommandRegistry;
    readonly contextKeys: ContextKeyService;
    /** Делегаты, с которыми открывали контекст-меню (последний — самый свежий). */
    readonly shown: IContextMenuDelegate[];
    readonly stored: Map<string, unknown>;
    /** Корневой контрол контейнера, отданный месту (сайдбару или панели). */
    root(containerId: string): TUIElement;
    /** Полоса контролов в таб-строке панели (`null` — контейнеру нечего показывать). */
    tabActions(containerId: string): TUIElement | null;
    /** Как место отдаёт контейнеру фокус. */
    focus(containerId: string): void;
    paneView(containerId: string): PaneViewElement;
    /**
     * Строка заголовка контейнера: в сайдбаре — над секциями (`null`, если
     * контейнер merged), в панели — полоса контролов таб-строки.
     */
    header(containerId: string): ViewContainerHeaderElement | null;
}

export function makeViewsHarness(contributions: readonly MenuContribution[] = []): IViewsHarness {
    const registered = new Map<string, { view: TUIElement; focus: () => void }>();
    const sidebar = {
        registerViewlet: (id: string, view: TUIElement, focus: () => void) => {
            registered.set(id, { view, focus });
        },
    } as unknown as SidebarService;

    const shown: IContextMenuDelegate[] = [];
    const contextMenu = {
        showContextMenu: (delegate: IContextMenuDelegate) => {
            shown.push(delegate);
        },
    } as unknown as ContextMenuService;

    const panelService = new PanelService();
    const commands = new CommandRegistry();
    const contextKeys = new ContextKeyService();
    const menuService = new MenuService(
        new MenuRegistry(commands, new KeybindingRegistry(), contextKeys, contributions),
    );

    const stored = new Map<string, unknown>();
    // Стор в памяти поверх null-сервиса: свои только get/store, остальное —
    // общие no-op'ы, чтобы не плодить их копии.
    const state: IStateService = {
        ...NULL_STATE_SERVICE,
        get<T>(descriptor: IStateDescriptor<T>): T {
            return stored.has(descriptor.key) ? (stored.get(descriptor.key) as T) : descriptor.default;
        },
        store<T>(descriptor: IStateDescriptor<T>, value: T): void {
            stored.set(descriptor.key, value);
        },
    };

    const panelView = (containerId: string): IPanelView | undefined =>
        panelService.getViews().find((v) => v.id === containerId);
    const root = (containerId: string): TUIElement => {
        const viewlet = registered.get(containerId);
        if (viewlet !== undefined) return viewlet.view;
        const panel = panelView(containerId);
        if (panel?.content != null) return panel.content;
        throw new Error(`makeViewsHarness: container "${containerId}" is not attached anywhere`);
    };
    const paneViewOf = (containerId: string): PaneViewElement => {
        const element = root(containerId);
        const selector = `#viewContainer-${containerId.replaceAll(".", "-")}`;
        // В панели корень контейнера — сам PaneViewElement, в сайдбаре он лежит
        // под стопкой с заголовком.
        return (element.id === selector.slice(1) ? element : element.querySelector(selector)) as PaneViewElement;
    };
    return {
        service: new ViewsService(sidebar, panelService, contextMenu, menuService, state),
        panelService,
        menuService,
        commands,
        contextKeys,
        shown,
        stored,
        root,
        focus: (containerId) => registered.get(containerId)!.focus(),
        tabActions: (containerId) => panelView(containerId)?.actions ?? null,
        paneView: paneViewOf,
        header: (containerId) => {
            const selector = `#viewContainerHeader-${containerId.replaceAll(".", "-")}`;
            const inTree = root(containerId).querySelector(selector);
            return (inTree ?? panelView(containerId)?.actions ?? null) as ViewContainerHeaderElement | null;
        },
    };
}

/** Дескриптор view с телом-филлером (`#<id>-body`) и настраиваемыми полями. */
export function testView(
    id: string,
    containerId: string,
    order: number,
    extra?: Partial<IViewDescriptor>,
): IViewDescriptor {
    const body = new FillerElement();
    body.id = `${id}-body`;
    return { id, containerId, title: id.toUpperCase(), order, body, focus: () => {}, ...extra };
}

/** Заголовки секций контейнера в порядке отображения. */
export function paneTitles(paneView: PaneViewElement): string[] {
    return paneView.getPaneIds().map((id) => {
        const header = paneView.querySelector(`#paneHeader-${id.replaceAll(".", "-")}`);
        return String(header?.inspectState()?.title);
    });
}
