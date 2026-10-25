import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";

import { Emitter } from "../../../../base/common/event.ts";
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
import type { WorkspaceId } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { WorkspaceContextService } from "../../../../platform/workspace/common/workspaceContextService.ts";
import { AuxiliaryBarService } from "../auxiliarybar/auxiliaryBarService.ts";
import type { IPanelView } from "../panel/panelService.ts";
import { PanelService } from "../panel/panelService.ts";
import type { SidebarService } from "../sidebar/sidebarService.ts";

import type { PaneViewElement } from "./paneViewElement.ts";
import type { ViewContainerHeaderElement } from "./viewContainerHeaderElement.ts";
import type { IViewDescriptor } from "./viewsService.ts";
import { ViewsService } from "./viewsService.ts";

export interface IViewsHarness {
    readonly service: ViewsService;
    readonly panelService: PanelService;
    readonly auxiliaryBarService: AuxiliaryBarService;
    readonly menuService: MenuService;
    readonly menuRegistry: MenuRegistry;
    readonly commands: CommandRegistry;
    readonly contextKeys: ContextKeyService;
    readonly workspace: WorkspaceContextService;
    /** The last one is the most recent. */
    readonly shown: IContextMenuDelegate[];
    readonly stored: Map<string, unknown>;
    openWorkspace(): void;
    readonly viewlets: string[];
    readonly shownViewlets: { id: string; reveal: boolean | undefined }[];
    readonly hiddenViewlets: string[];
    /** ViewsService resolves header buttons only for the shown container. */
    showViewlet(containerId: string): void;
    root(containerId: string): TUIElement;
    /** `null` — the container has nothing to show. */
    tabActions(containerId: string): TUIElement | null;
    focus(containerId: string): void;
    paneView(containerId: string): PaneViewElement;
    /** In the sidebar — above the sections (`null` when merged); in the panel — the tab bar control strip. */
    header(containerId: string): ViewContainerHeaderElement | null;
}

export function makeViewsHarness(contributions: readonly MenuContribution[] = []): IViewsHarness {
    const registered = new Map<string, { view: TUIElement; focus: () => void }>();
    const shownViewlets: { id: string; reveal: boolean | undefined }[] = [];
    // The active viewlet decides whether ViewsService computes header buttons now or when shown.
    let activeViewlet: string | null = null;
    const activeViewletEmitter = new Emitter<string>();
    const hiddenViewlets: string[] = [];
    const sidebar = {
        registerViewlet: (id: string, view: TUIElement, focus: () => void) => {
            registered.set(id, { view, focus });
        },
        showViewlet: (id: string, reveal?: boolean) => {
            shownViewlets.push({ id, reveal });
            if (!registered.has(id) || activeViewlet === id) return;
            activeViewlet = id;
            activeViewletEmitter.fire(id);
        },
        unregisterViewlet: (id: string) => {
            registered.delete(id);
            if (activeViewlet === id) activeViewlet = null;
        },
        getActiveViewletId: () => activeViewlet,
        isViewletVisible: (id: string) => activeViewlet === id,
        hideViewlet: (id: string) => {
            if (activeViewlet === id) hiddenViewlets.push(id);
        },
        onDidChangeActiveViewlet: activeViewletEmitter.event,
    } as unknown as SidebarService;

    const shown: IContextMenuDelegate[] = [];
    const contextMenu = {
        showContextMenu: (delegate: IContextMenuDelegate) => {
            shown.push(delegate);
        },
    } as unknown as ContextMenuService;

    const panelService = new PanelService();
    const auxiliaryBarService = new AuxiliaryBarService();
    const commands = new CommandRegistry();
    const contextKeys = new ContextKeyService();
    const menuRegistry = new MenuRegistry(commands, new KeybindingRegistry(), contextKeys, contributions);
    const menuService = new MenuService(menuRegistry);

    const stored = new Map<string, unknown>();
    const openWorkspaceEmitter = new Emitter<WorkspaceId>();
    const state: IStateService = {
        ...NULL_STATE_SERVICE,
        get<T>(descriptor: IStateDescriptor<T>): T {
            return stored.has(descriptor.key) ? (stored.get(descriptor.key) as T) : descriptor.default;
        },
        store<T>(descriptor: IStateDescriptor<T>, value: T): void {
            stored.set(descriptor.key, value);
        },
        openWorkspace(workspaceId: WorkspaceId): void {
            openWorkspaceEmitter.fire(workspaceId);
        },
        onDidOpenWorkspace: openWorkspaceEmitter.event,
    };

    const panelView = (containerId: string): IPanelView | undefined =>
        [...panelService.getViews(), ...auxiliaryBarService.getViews()].find((v) => v.id === containerId);
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
        // In the panel the root is the PaneViewElement itself; in the sidebar it's the stack with the header above it.
        return (element.id === selector.slice(1) ? element : element.querySelector(selector)) as PaneViewElement;
    };
    const workspace = new WorkspaceContextService();
    return {
        service: new ViewsService(
            sidebar,
            panelService,
            contextMenu,
            menuService,
            state,
            workspace,
            commands,
            auxiliaryBarService,
        ),
        panelService,
        auxiliaryBarService,
        menuService,
        menuRegistry,
        commands,
        contextKeys,
        workspace,
        shown,
        stored,
        openWorkspace: () => {
            state.openWorkspace("project" as WorkspaceId);
        },
        get viewlets() {
            return [...registered.keys()];
        },
        shownViewlets,
        hiddenViewlets,
        showViewlet: (containerId) => {
            sidebar.showViewlet(containerId);
        },
        root,
        focus: (containerId) => {
            const viewlet = registered.get(containerId);
            if (viewlet === undefined) throw new Error(`makeViewsHarness: viewlet "" is not registered`);
            viewlet.focus();
        },
        tabActions: (containerId) => panelView(containerId)?.actions ?? null,
        paneView: paneViewOf,
        header: (containerId) => {
            const selector = `#viewContainerHeader-${containerId.replaceAll(".", "-")}`;
            const inTree = root(containerId).querySelector(selector);
            return (inTree ?? panelView(containerId)?.actions ?? null) as ViewContainerHeaderElement | null;
        },
    };
}

export function testView(
    id: string,
    containerId: string,
    order: number,
    extra?: Partial<IViewDescriptor>,
): IViewDescriptor {
    const body = new FillerElement();
    body.id = `${id}-body`;
    return {
        id,
        containerId,
        title: id.toUpperCase(),
        order,
        body,
        focus: () => {
            /* no-op */
        },
        ...extra,
    };
}

export function paneTitles(paneView: PaneViewElement): string[] {
    return paneView.getPaneIds().map((id) => {
        const header = paneView.querySelector(`#paneHeader-${id.replaceAll(".", "-")}`);
        return String(header?.inspectState()?.title);
    });
}
