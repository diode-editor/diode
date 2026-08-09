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
import type { SidebarService } from "../sidebar/sidebarService.ts";

import type { PaneViewElement } from "./paneViewElement.ts";
import type { ViewContainerHeaderElement } from "./viewContainerHeaderElement.ts";
import type { IViewDescriptor } from "./viewsService.ts";
import { ViewsService } from "./viewsService.ts";

/** Общий стенд тестов ViewsService: реальные реестры меню, фейки места и стора. */
export interface IViewsHarness {
    readonly service: ViewsService;
    readonly menuService: MenuService;
    readonly commands: CommandRegistry;
    readonly contextKeys: ContextKeyService;
    /** Делегаты, с которыми открывали контекст-меню (последний — самый свежий). */
    readonly shown: IContextMenuDelegate[];
    readonly stored: Map<string, unknown>;
    /** Корневой контрол контейнера, отданный месту. */
    root(containerId: string): TUIElement;
    /** Как место отдаёт контейнеру фокус. */
    focus(containerId: string): void;
    paneView(containerId: string): PaneViewElement;
    /** Заголовок контейнера; `null` — контейнер merged, своего заголовка у него нет. */
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

    const commands = new CommandRegistry();
    const contextKeys = new ContextKeyService();
    const menuService = new MenuService(
        new MenuRegistry(commands, new KeybindingRegistry(), contextKeys, contributions),
    );

    const stored = new Map<string, unknown>();
    const state: IStateService = {
        get<T>(descriptor: IStateDescriptor<T>): T {
            return stored.has(descriptor.key) ? (stored.get(descriptor.key) as T) : descriptor.default;
        },
        store<T>(descriptor: IStateDescriptor<T>, value: T): void {
            stored.set(descriptor.key, value);
        },
        openWorkspace: () => {},
        flushSync: () => {},
    };

    const root = (containerId: string): TUIElement => registered.get(containerId)!.view;
    return {
        service: new ViewsService(sidebar, contextMenu, menuService, state),
        menuService,
        commands,
        contextKeys,
        shown,
        stored,
        root,
        focus: (containerId) => registered.get(containerId)!.focus(),
        paneView: (containerId) => root(containerId).querySelector(`#viewContainer-${containerId}`) as PaneViewElement,
        header: (containerId) =>
            root(containerId).querySelector(
                `#viewContainerHeader-${containerId.replaceAll(".", "-")}`,
            ) as ViewContainerHeaderElement | null,
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
