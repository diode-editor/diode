import { codicon } from "../../../base/common/codicons.ts";
import { Emitter } from "../../../base/common/event.ts";
import { DisposableStore, type IDisposable } from "../../../base/common/lifecycle.ts";
import { Uri } from "../../../base/common/uri.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import type { IMenuEntryGroup, MenuContextKeys, MenuRegistry } from "../../../platform/actions/common/menuRegistry.ts";
import type { MenuService } from "../../../platform/actions/common/menuService.ts";
import type { CommandRegistry } from "../../../platform/commands/common/commandRegistry.ts";
import type { IConfigurationService } from "../../../platform/configuration/common/iConfigurationService.ts";
import type { ContextKeyService } from "../../../platform/contextkey/common/contextKeyService.ts";
import type { ContextMenuService } from "../../../platform/contextview/browser/contextMenuService.ts";
import type { ILogger } from "../../../platform/log/common/iLogger.ts";
import { type IProductIconService, NERD_FONT_ICONS } from "../../../platform/theme/common/productIconService.ts";
import type { IWorkspaceContextService } from "../../../platform/workspace/common/iWorkspaceContextService.ts";
import type { ViewsService } from "../../browser/parts/views/viewsService.ts";
import type { IExtensionTreeDataSource, IExtensionTreeViewsSink } from "../common/iExtensionTreeViewsSink.ts";
import type { IThemeColorResolver } from "../common/iThemeColorResolver.ts";
import type {
    IWireTreeItem,
    IWireTreeViewRegistration,
    IWireTreeViewReveal,
    IWireTreeViewTitle,
} from "../common/treeViewWireTypes.ts";

import { ExtensionTreeView, type IExtensionTreeViewHost } from "./extensionTreeView.ts";
import type { ExtensionViewWelcomes } from "./extensionViewWelcomes.ts";

export interface IExtensionTreeViewsAdapterServices {
    readonly views: ViewsService;
    /** Puts the tree into its section, or the view's `viewsWelcome` while the tree has nothing to show. */
    readonly welcomes: Pick<ExtensionViewWelcomes, "setTree">;
    readonly commands: CommandRegistry;
    readonly menus: MenuRegistry;
    /** `view/item/context` with its submenus, resolved per row. */
    readonly menuService: Pick<MenuService, "getEntryGroups">;
    readonly contextMenu: Pick<ContextMenuService, "showContextMenu">;
    /** A change of a key a row's menu reads redraws the inline buttons. */
    readonly contextKeys: Pick<ContextKeyService, "onDidChange">;
    readonly configuration: IConfigurationService;
    readonly workspace: IWorkspaceContextService;
    readonly colors: Pick<IThemeColorResolver, "resolve">;
    /** A toast: upstream `notificationService.error` for a failed row command. */
    notifyError(message: string): void;
    readonly icons?: IProductIconService;
    readonly logger?: ILogger;
}

interface IRegisteredTree {
    readonly tree: ExtensionTreeView;
    readonly store: DisposableStore;
}

/**
 * Upstream `MainThreadTreeViews` + the `TreeViewPane` side: a registered tree becomes the body of its
 * contributed section (through {@link ExtensionViewWelcomes}, which shows `viewsWelcome` instead while
 * the tree is empty), and the section's state goes back to the subprocess.
 * `visible` is "the section is expanded in the shown container", recomputed on every show and
 * expand/collapse.
 *
 * Deviation: a tree for a view nobody contributed is an Output line, not upstream's error.
 */
export class ExtensionTreeViewsAdapter implements IExtensionTreeViewsSink, IDisposable {
    private readonly trees = new Map<string, IRegisteredTree>();
    private readonly store = new DisposableStore();
    private readonly host: IExtensionTreeViewHost;
    private readonly onDidChangeItemMenu = new Emitter<void>();
    /** An Output line once per command: the rows ask for the menu on every redraw. */
    private readonly reportedCommands = new Set<string>();

    public constructor(private readonly services: IExtensionTreeViewsAdapterServices) {
        const { views, configuration, workspace, menus, contextKeys } = services;
        this.host = {
            openOnSingleClick: () => configuration.get("workbench.list.openMode") !== "doubleClick",
            expandOnRowClick: () => configuration.get("workbench.tree.expandMode") !== "doubleClick",
            notifyError: (message) => {
                services.notifyError(message);
            },
            // `typeof`: a theme table answers `toString` too.
            hasColor: (token) => typeof services.colors.resolve(token) === "number",
            relativeDirectory: (uri) => relativeDirectory(workspace, uri),
            icons: services.icons ?? NERD_FONT_ICONS,
            itemMenu: (viewId, contextValue) => this.itemMenu(viewId, contextValue),
            onDidChangeItemMenu: this.onDidChangeItemMenu.event,
            showContextMenu: (owner, anchor, entries) => {
                services.contextMenu.showContextMenu({
                    getOwner: () => owner,
                    getAnchor: () => anchor,
                    getEntries: () => entries,
                });
            },
            executeCommand: (id, args) => services.commands.execute(id, ...args),
            logger: services.logger,
        };
        this.store.add(this.onDidChangeItemMenu);
        this.store.add(
            menus.onDidChangeMenu((menuId) => {
                if (menuId === MenuId.ViewItemContext) this.onDidChangeItemMenu.fire();
            }),
        );
        this.store.add(
            contextKeys.onDidChange((changed) => {
                const read = menus.getMenuContexts(MenuId.ViewItemContext);
                if ([...changed].some((key) => read.has(key))) this.onDidChangeItemMenu.fire();
            }),
        );
        const sync = (): void => {
            this.syncVisibility();
        };
        this.store.add(views.onDidShowView(sync));
        this.store.add(views.onDidChangeViewExpanded(sync));
        this.store.add(views.onDidChangeLocations(sync));
    }

    public register(registration: IWireTreeViewRegistration, source: IExtensionTreeDataSource): void {
        const { viewId } = registration;
        const options = { canSelectMany: registration.canSelectMany };
        const known = this.trees.get(viewId);
        if (known !== undefined) {
            known.tree.setSource(source, options);
            return;
        }
        if (this.services.views.getViewContainerByViewId(viewId) === null && !this.isContributed(viewId)) {
            const owner = registration.extensionId === undefined ? "" : ` (${registration.extensionId})`;
            this.services.logger?.warn(
                `tree view "${viewId}"${owner}: no view with this id is contributed (contributes.views), the tree is not shown`,
            );
        }
        const tree = new ExtensionTreeView(viewId, source, options, this.host);
        const store = new DisposableStore();
        store.add(tree);
        if (registration.showCollapseAll) store.add(this.registerCollapseAll(tree));
        this.trees.set(viewId, { tree, store });
        this.services.welcomes.setTree(viewId, tree);
        tree.setVisible(this.isVisible(viewId));
    }

    public unregister(viewId: string): void {
        const registered = this.trees.get(viewId);
        if (registered === undefined) return;
        this.trees.delete(viewId);
        registered.store.dispose();
        this.services.welcomes.setTree(viewId, null);
        this.services.views.setViewTitle(viewId, undefined, null);
    }

    public async refresh(viewId: string, items: readonly IWireTreeItem[] | undefined): Promise<void> {
        await this.trees.get(viewId)?.tree.refresh(items);
    }

    /** Upstream opens the view first (`viewsService.openView(id, focus)`). */
    public async reveal(request: IWireTreeViewReveal): Promise<void> {
        const registered = this.trees.get(request.viewId);
        if (registered === undefined) return;
        // A view that is not registered right now (its `when` is false) is not opened; showing a section reaches
        // the tree through the view events.
        this.services.views.openView(request.viewId, request.focus);
        await registered.tree.reveal(request);
    }

    public setMessage(viewId: string, message: string): void {
        this.trees.get(viewId)?.tree.setMessage(message);
    }

    /** Upper-cased like the other section titles (upstream's `text-transform`). */
    public setTitle({ viewId, title, description }: IWireTreeViewTitle): void {
        if (!this.trees.has(viewId)) return;
        this.services.views.setViewTitle(viewId, title?.toUpperCase(), description ?? null);
    }

    public reset(): void {
        for (const viewId of [...this.trees.keys()]) this.unregister(viewId);
    }

    public getTree(viewId: string): ExtensionTreeView | undefined {
        return this.trees.get(viewId)?.tree;
    }

    public dispose(): void {
        this.reset();
        // Stryker disable next-line CallExpression: equivalent — after reset() there is no tree left for the view events to update
        this.store.dispose();
    }

    /**
     * Upstream `TreeMenus`: the row's own `view` and `viewItem` over the global keys. Upstream skips an item of a
     * command no extension declares when it reads the manifest; here the command may come later, so the row
     * drops it until it exists.
     */
    private itemMenu(viewId: string, contextValue: string | undefined): IMenuEntryGroup[] {
        const keys: MenuContextKeys =
            contextValue === undefined ? { view: viewId } : { view: viewId, viewItem: contextValue };
        return this.services.menuService
            .getEntryGroups(MenuId.ViewItemContext, undefined, keys)
            .map((group) => ({
                group: group.group,
                entries: group.entries.filter((entry) => {
                    if (entry.type === "separator" || entry.type === "submenu") return true;
                    // Stryker disable next-line ConditionalExpression: the registry always sets `id` (the command) on an item entry
                    if (entry.id === undefined || this.services.commands.has(entry.id)) return true;
                    if (!this.reportedCommands.has(entry.id)) {
                        this.reportedCommands.add(entry.id);
                        this.services.logger?.warn(
                            `view/item/context: command "${entry.id}" is not registered, its item is not shown`,
                        );
                    }
                    return false;
                }),
            }))
            .filter((group) => group.entries.length > 0);
    }

    private syncVisibility(): void {
        for (const [viewId, { tree }] of this.trees) tree.setVisible(this.isVisible(viewId));
    }

    /** `isViewShown` is false for a view that is not registered, so `isViewExpanded` is never asked about one. */
    private isVisible(viewId: string): boolean {
        const { views } = this.services;
        return views.isViewShown(viewId) && views.isViewExpanded(viewId);
    }

    /** A view with a `when` that is false right now is still contributed: it gets the tree when it shows. */
    private isContributed(viewId: string): boolean {
        return this.services.commands.has(`${viewId}.focus`);
    }

    /** Upstream `workbench.actions.treeView.<id>.collapseAll`: last in the title's `navigation` group. */
    private registerCollapseAll(tree: ExtensionTreeView): IDisposable {
        const id = `workbench.actions.treeView.${tree.viewId}.collapseAll`;
        const store = new DisposableStore();
        store.add(this.services.commands.register(id, () => tree.collapseAll(), "Collapse All"));
        store.add(
            this.services.menus.appendMenuItem({
                menuId: MenuId.ViewTitle,
                command: id,
                when: `view == ${tree.viewId}`,
                group: "navigation",
                order: Number.MAX_SAFE_INTEGER,
                icon: codicon("collapse-all"),
            }),
        );
        this.services.views.refreshTitleActions();
        return store;
    }
}

/** Upstream's resource label path: the parent folder relative to the workspace folder that holds it. */
function relativeDirectory(workspace: IWorkspaceContextService, uri: string): string {
    const resource = Uri.parse(uri);
    const directory = resource.path.slice(0, Math.max(0, resource.path.lastIndexOf("/")));
    for (const folder of workspace.getWorkspace().folders) {
        const root = folder.uri.path;
        if (folder.uri.scheme !== resource.scheme) continue;
        if (directory === root) return "";
        if (directory.startsWith(`${root}/`)) return directory.slice(root.length + 1);
    }
    // Stryker disable next-line ConditionalExpression,EqualityOperator,StringLiteral,ObjectLiteral: equivalent on POSIX — `fsPath` is the path there; it differs on Windows (drive letter, backslashes)
    return resource.scheme === "file" ? resource.with({ path: directory }).fsPath : directory;
}
