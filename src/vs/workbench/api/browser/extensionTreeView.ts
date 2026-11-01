import type { OverlayAnchorPosition } from "@tuidom/core/dom/overlayLayer";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { MenuEntry, MenuItemEntry } from "@tuidom/elements/menu/popupMenuElement";
import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import type { ITreeDataProvider, ITreeItem, ITreeItemAction } from "@tuidom/elements/tree/iTreeDataProvider";
import { type TreeIndentGuides, TreeViewElement } from "@tuidom/elements/tree/treeViewElement";

import { CODICON_GLYPHS } from "../../../base/common/codicons.generated.ts";
import { Emitter, type Event } from "../../../base/common/event.ts";
import { DisposableStore, type IDisposable } from "../../../base/common/lifecycle.ts";
import { Uri } from "../../../base/common/uri.ts";
import {
    type IMenuEntryGroup,
    type IResolvedMenuItemEntry,
    joinMenuGroups,
    type ResolvedMenuEntry,
} from "../../../platform/actions/common/menuRegistry.ts";
import type { ILogger } from "../../../platform/log/common/iLogger.ts";
import type { IProductIconService } from "../../../platform/theme/common/productIconService.ts";
import { HeaderBodyViewElement } from "../../browser/parts/views/headerBodyViewElement.ts";
import { ViewMessageElement } from "../../browser/parts/views/viewMessageElement.ts";
import type { IExtensionTreeDataSource } from "../common/iExtensionTreeViewsSink.ts";
import type { IWireTreeItem, IWireTreeItemHandleArg, IWireTreeViewReveal } from "../common/treeViewWireTypes.ts";

import type { IWelcomeTree } from "./extensionViewWelcomes.ts";

/** What a tree needs from the workbench; the adapter wires it to the services. */
export interface IExtensionTreeViewHost {
    /** `workbench.list.openMode`/`workbench.tree.expandMode`, read on every gesture as Explorer does. */
    readonly openOnSingleClick: () => boolean;
    readonly expandOnRowClick: () => boolean;
    /** `workbench.tree.renderIndentGuides`, read on every frame. */
    readonly renderIndentGuides: () => TreeIndentGuides;
    /** The setting changed: the rows are redrawn. */
    readonly onDidChangeRenderIndentGuides: Event<void>;
    /** Upstream `notificationService.error` for a row command that failed. */
    notifyError(message: string): void;
    /**
     * A `ThemeIcon` color is a token of the theme only if the theme has it: an unknown token (an
     * extension's own `contributes.colors`) would throw in the frame.
     */
    hasColor(token: string): boolean;
    /** `description: true`: the folder of the resource relative to its workspace folder, `""` at its root. */
    relativeDirectory(uri: string): string;
    /** `diode.icons.nerdFont`: the rows are redrawn when it changes. */
    readonly icons: IProductIconService;
    /**
     * `view/item/context` for a row (upstream `TreeMenus.getActions`): resolved with `view = <viewId>` and
     * `viewItem = <contextValue>` on top of the global keys, no `viewItem` for a row without a context value.
     */
    itemMenu(viewId: string, contextValue: string | undefined): readonly IMenuEntryGroup[];
    /** Its items or the keys their `when` reads changed: the inline buttons are redrawn. */
    readonly onDidChangeItemMenu: Event<void>;
    showContextMenu(owner: TUIElement, anchor: OverlayAnchorPosition, entries: MenuEntry[]): void;
    /** A menu item's command; a throw or a rejection becomes {@link notifyError}. */
    executeCommand(id: string, args: readonly unknown[]): unknown;
    readonly logger?: ILogger;
}

/** The host's row: the handle is the key, the item is replaced in place on refresh, so the tree holds one object. */
export interface IExtensionTreeNode {
    readonly handle: string;
    item: IWireTreeItem;
}

/** Upstream `TreeItemCollapsibleState.Expanded`. */
const EXPANDED = 2;

/** Upstream `getContextMenuActions(menuData, 'inline')`: this group is the row's buttons, the rest its menu. */
const INLINE_GROUP = "inline";

const NO_CHILDREN: readonly IExtensionTreeNode[] = [];

/**
 * Upstream `CustomTreeView`: the section body of a contributed view whose extension registered a tree.
 * Rows come by handle from the subprocess ({@link IExtensionTreeDataSource}); the root is read when the
 * section is visible, children when a node expands. A refresh keeps the old rows until the answer
 * arrives, and expansion and the cursor survive it by handle (the tree's key).
 */
export class ExtensionTreeView implements IWelcomeTree, IDisposable {
    public readonly view: TUIElement;
    private readonly tree: TreeViewElement<IExtensionTreeNode>;
    private readonly message = new ViewMessageElement();
    private source: IExtensionTreeDataSource;
    private canSelectMany: boolean;
    private readonly nodes = new Map<string, IExtensionTreeNode>();
    /**
     * The last answer per parent (`""` is the root): a failed request leaves the rows that were there,
     * also when the request is the new provider's after a re-registration.
     */
    private readonly lastChildren = new Map<string, readonly IExtensionTreeNode[]>();
    /** `Expanded` applies when a row first appears, not on every reread. */
    private readonly seen = new Set<string>();
    /**
     * Parents (`""` is the root) whose request failed during the current reread. The subprocess dropped
     * their subtree before asking the extension, so it would answer their expanded descendants with
     * nothing: those keep their last rows too.
     */
    private readonly failed = new Set<string>();
    /** For Collapse All: the tree keeps its expansion private. */
    private readonly expanded = new Map<string, IExtensionTreeNode>();
    private visible = false;
    /** The root has to be (re)read the next time the section is visible. */
    private stale = true;
    /** The latest root read: `reveal` and a refresh wait for it. */
    private loading: Promise<void> = Promise.resolve();
    /** A redraw: the rows come from the last answers, the subprocess is not asked. */
    private redrawing = false;
    private readonly subscriptions = new DisposableStore();
    /** Upstream `isTreeEmpty`: `true` until the first root answer, as upstream's `_isEmpty`. */
    private empty = true;
    private readonly onDidChangeWelcomeStateEmitter = new Emitter<void>();
    public readonly onDidChangeWelcomeState = this.onDidChangeWelcomeStateEmitter.event;

    public constructor(
        public readonly viewId: string,
        source: IExtensionTreeDataSource,
        options: { readonly canSelectMany: boolean },
        private readonly host: IExtensionTreeViewHost,
    ) {
        this.source = source;
        this.canSelectMany = options.canSelectMany;
        const provider: ITreeDataProvider<IExtensionTreeNode> = {
            getTreeItem: (node) => this.toTreeItem(node.item),
            getChildren: (node) => this.loadChildren(node),
            getKey: (node) => node.handle,
        };
        // The same 1-column indent and gestures as Explorer; a row with a command opens on click and expands
        // only by its chevron, as upstream (`expandOnlyOnTwistieClick: !!e.command || …`).
        this.tree = new TreeViewElement(provider, {
            leftPadding: 1,
            expandOnlyOnTwistieClick: (node) => node.item.command !== undefined || !host.expandOnRowClick(),
            openOnSingleClick: () => host.openOnSingleClick(),
            renderIndentGuides: () => host.renderIndentGuides(),
        });
        const scrollBars = new ScrollBarDecorator(this.tree);
        scrollBars.style = { fg: "sideBar.foreground", bg: "sideBar.background" };
        this.view = new HeaderBodyViewElement(this.message, scrollBars);
        this.view.id = `extensionTreeView-${viewId.replaceAll(".", "-")}`;

        this.tree.onActivate = (node) => {
            this.runCommand(node);
        };
        this.tree.onExpandedChanged = (node, isExpanded) => {
            if (isExpanded) this.expanded.set(node.handle, node);
            else this.expanded.delete(node.handle);
            this.source.setExpanded(node.handle, isExpanded);
        };
        this.tree.onContextMenu = (node, screenX, screenY) => {
            this.showContextMenu(node, { screenX, screenY });
        };
        this.tree.onInlineAction = (node, index) => {
            this.runInlineAction(node, index);
        };
        this.tree.onSelect = (node) => {
            const selected = this.canSelectMany ? this.tree.getSelectedNodes() : [node];
            this.source.setSelection(
                selected.map((entry) => entry.handle),
                node.handle,
            );
        };
        const redraw = (): void => {
            void this.redraw();
        };
        this.subscriptions.add(host.icons.onDidChange(redraw));
        this.subscriptions.add(
            host.onDidChangeRenderIndentGuides(() => {
                this.tree.markDirty();
            }),
        );
        this.subscriptions.add(host.onDidChangeItemMenu(redraw));
    }

    public dispose(): void {
        this.subscriptions.dispose();
        this.onDidChangeWelcomeStateEmitter.dispose();
    }

    /** Upstream `TreeViewPane.shouldShowWelcome`: an empty root and no message. */
    public shouldShowWelcome(): boolean {
        return this.empty && this.message.getText() === "";
    }

    /** A repeated registration: the new provider answers, the tree rereads, expansion stays by handle. */
    public setSource(source: IExtensionTreeDataSource, options: { readonly canSelectMany: boolean }): void {
        this.source = source;
        this.canSelectMany = options.canSelectMany;
        // The new subprocess-side view starts hidden: tell it the truth.
        if (this.visible) source.setVisible(true);
        void this.refreshRoot();
    }

    public setVisible(visible: boolean): void {
        if (this.visible === visible) return;
        this.visible = visible;
        this.source.setVisible(visible);
        if (visible && this.stale) void this.loadRoot();
    }

    /** `undefined` — the root. Rows not in the tree are ignored, as upstream. */
    public async refresh(items: readonly IWireTreeItem[] | undefined): Promise<void> {
        if (items === undefined) {
            await this.refreshRoot();
            return;
        }
        const rekeyed = items.filter((item) => item.previousHandle !== undefined && this.forget(item.previousHandle));
        for (const item of items) {
            const node = this.nodes.get(item.handle);
            if (node !== undefined) node.item = item;
        }
        // Not read yet: the rows are drawn from the updated items when the section shows.
        if (this.stale) return;
        for (const item of items) {
            const node = this.nodes.get(item.handle);
            if (node === undefined) continue;
            this.failed.clear();
            await this.tree.refresh(node);
        }
        // Upstream `getItemsToRefresh`: the tree keys rows by handle, so a row under a new one comes from its parent.
        for (const parentHandle of new Set(rekeyed.map((item) => item.parentHandle))) {
            const parent = parentHandle === undefined ? undefined : this.nodes.get(parentHandle);
            if (parent === undefined) await this.loadRoot();
            else await this.tree.refresh(parent);
        }
    }

    /** `false` — the host has no such row: it isn't in the tree, and is ignored as upstream. */
    private forget(handle: string): boolean {
        this.expanded.delete(handle);
        this.lastChildren.delete(handle);
        return this.nodes.delete(handle);
    }

    public setMessage(message: string): void {
        const before = this.shouldShowWelcome();
        this.message.setText(message);
        if (this.shouldShowWelcome() !== before) this.onDidChangeWelcomeStateEmitter.fire();
    }

    public getMessage(): string {
        return this.message.getText();
    }

    /** Upstream `CollapseAllAction`. */
    public async collapseAll(): Promise<void> {
        for (const node of [...this.expanded.values()]) await this.tree.toggleExpand(node);
    }

    public focus(): void {
        this.tree.focus();
    }

    public get treeElement(): TreeViewElement<IExtensionTreeNode> {
        return this.tree;
    }

    /** The section was opened by the caller; this expands the ancestors, places the cursor and expands the item. */
    public async reveal(request: IWireTreeViewReveal): Promise<void> {
        if (this.stale) void this.loadRoot();
        await this.loading;
        if (request.item !== undefined) {
            const chain = [...request.parentChain, request.item].map((item) => this.nodeFor(item));
            await this.tree.reveal(chain);
            // `true` is one level, a number is that many, `false` none.
            await this.expandLevels([chain[chain.length - 1]], Number(request.expand));
        }
        if (request.focus) this.focus();
    }

    private async expandLevels(nodes: readonly IExtensionTreeNode[], levels: number): Promise<void> {
        if (levels <= 0) return;
        const collapsible = nodes.filter((node) => node.item.collapsibleState !== 0);
        await this.tree.expandElements(collapsible);
        const children = collapsible.flatMap((node) => this.lastChildren.get(node.handle) ?? NO_CHILDREN);
        await this.expandLevels(children, levels - 1);
    }

    private refreshRoot(): Promise<void> {
        this.stale = true;
        return this.visible ? this.loadRoot() : Promise.resolve();
    }

    private loadRoot(): Promise<void> {
        this.stale = false;
        this.failed.clear();
        this.loading = this.tree.refresh();
        return this.loading;
    }

    /**
     * Upstream `onContextMenu`: the row's menu without its inline group; for a row in a selection of several,
     * only the items every selected row has. No items — no menu.
     */
    private showContextMenu(node: IExtensionTreeNode, anchor: OverlayAnchorPosition): void {
        const selection = this.selectionOf(node);
        // The clicked row is in the selection: intersecting with its own menu changes nothing.
        const menus = (selection ?? []).map((target) => this.menuGroups(target.item, false));
        const groups = this.menuGroups(node.item, false)
            .map((group) => ({
                group: group.group,
                entries: group.entries.filter((entry) => menus.every((menu) => hasEntry(menu, entry))),
            }))
            .filter((group) => group.entries.length > 0);
        const args =
            selection === null
                ? [this.rowArg(node)]
                : [this.rowArg(node), selection.map((target) => this.rowArg(target))];
        const entries = joinMenuGroups(groups).map((entry) => this.bindEntry(entry, args));
        if (entries.length === 0) return;
        this.host.showContextMenu(this.tree, anchor, entries);
    }

    /** Resolved again on the click, as upstream's buttons: the item under the glyph runs with its row's element. */
    private runInlineAction(node: IExtensionTreeNode, index: number): void {
        const entry = inlineEntries(this.menuGroups(node.item, true)).at(index);
        // A glyph drawn before the menu changed.
        if (entry === undefined) return;
        this.runEntry(entry, [this.rowArg(node)]);
    }

    private menuGroups(item: IWireTreeItem, inline: boolean): IMenuEntryGroup[] {
        return this.host
            .itemMenu(this.viewId, item.contextValue)
            .filter((group) => (group.group === INLINE_GROUP) === inline);
    }

    /** Upstream `MultipleSelectionActionRunner`: a selection of several counts only when the row is in it. */
    private selectionOf(node: IExtensionTreeNode): readonly IExtensionTreeNode[] | null {
        if (!this.canSelectMany) return null;
        const selected = this.tree.getSelectedNodes();
        // Stryker disable next-line ConditionalExpression,LogicalOperator: the tree widget moves the selection to a row right-clicked outside it; kept as upstream for a cursor outside the selection
        return selected.length > 1 && selected.includes(node) ? selected : null;
    }

    /** The subprocess turns it back into the provider's element. */
    private rowArg(node: IExtensionTreeNode): IWireTreeItemHandleArg {
        return { $treeViewId: this.viewId, $treeItemHandle: node.handle };
    }

    /** The registry's entry runs the command without the row; ours passes it and reports a failure. */
    private bindEntry(entry: MenuEntry, args: readonly unknown[]): MenuEntry {
        // Stryker disable next-line ConditionalExpression,StringLiteral: equivalent — a separator given `onSelect` below is still a separator to the popup
        if (entry.type === "separator") return entry;
        if (entry.type === "submenu") {
            // Stryker disable next-line ConditionalExpression,EqualityOperator,StringLiteral: the registry resolves submenus eagerly, a lazy list never comes here
            const entries = typeof entry.entries === "function" ? entry.entries() : entry.entries;
            return { ...entry, entries: entries.map((child) => this.bindEntry(child, args)) };
        }
        return {
            ...entry,
            onSelect: () => {
                this.runEntry(entry, args);
            },
        };
    }

    private runEntry(entry: MenuItemEntry, args: readonly unknown[]): void {
        // Stryker disable next-line ConditionalExpression: the registry always sets `id` (the command) on an item entry
        if (entry.disabled === true || entry.id === undefined) return;
        const fail = (err: unknown): void => {
            this.host.notifyError(err instanceof Error ? err.message : String(err));
        };
        try {
            Promise.resolve(this.host.executeCommand(entry.id, args)).catch(fail);
        } catch (err: unknown) {
            fail(err);
        }
    }

    /** The glyphs are baked into the rows: they are rebuilt from the last answers. */
    private async redraw(): Promise<void> {
        // Not read yet: the rows are drawn with the current glyphs when the section shows.
        if (this.stale) return;
        this.redrawing = true;
        try {
            await this.tree.refresh();
        } finally {
            this.redrawing = false;
        }
    }

    private async loadChildren(parent: IExtensionTreeNode | undefined): Promise<IExtensionTreeNode[]> {
        const key = parent?.handle ?? "";
        // A row expanded during the redraw has no answer yet: it is asked as usual.
        const cached = this.redrawing && this.lastChildren.has(key);
        if (cached || this.underFailure(parent)) return [...(this.lastChildren.get(key) ?? NO_CHILDREN)];
        const source = this.source;
        let items: readonly IWireTreeItem[];
        try {
            items = await source.getChildren(parent?.handle);
        } catch (err: unknown) {
            this.host.logger?.error(`tree view "${this.viewId}": ${err instanceof Error ? err.message : String(err)}`);
            this.failed.add(key);
            return [...(this.lastChildren.get(key) ?? NO_CHILDREN)];
        }
        // A newer registration replaced the provider while this one answered.
        if (source !== this.source) return [...(this.lastChildren.get(key) ?? NO_CHILDREN)];
        const children = items.map((item) => this.nodeFor(item));
        this.lastChildren.set(key, children);
        if (parent === undefined) this.setEmpty(children.length === 0);
        const firstExpanded = children.filter((node) => {
            const fresh = !this.seen.has(node.handle);
            this.seen.add(node.handle);
            return fresh && node.item.collapsibleState === EXPANDED;
        });
        // After the tree has taken these children: it expands a row it already lists.
        queueMicrotask(() => {
            void this.tree.expandElements(firstExpanded);
        });
        return children;
    }

    private setEmpty(empty: boolean): void {
        const before = this.shouldShowWelcome();
        this.empty = empty;
        if (this.shouldShowWelcome() !== before) this.onDidChangeWelcomeStateEmitter.fire();
    }

    /** The root or an ancestor of the row failed in this reread. */
    private underFailure(node: IExtensionTreeNode | undefined): boolean {
        if (node === undefined) return false;
        if (this.failed.has("")) return true;
        let handle = node.item.parentHandle;
        while (handle !== undefined) {
            if (this.failed.has(handle)) return true;
            // Stryker disable next-line OptionalChaining: equivalent — every listed row's parent is listed too
            handle = this.nodes.get(handle)?.item.parentHandle;
        }
        return false;
    }

    private nodeFor(item: IWireTreeItem): IExtensionTreeNode {
        const known = this.nodes.get(item.handle);
        if (known !== undefined) {
            known.item = item;
            return known;
        }
        const node: IExtensionTreeNode = { handle: item.handle, item };
        this.nodes.set(item.handle, node);
        return node;
    }

    private runCommand(node: IExtensionTreeNode): void {
        if (node.item.command === undefined) return;
        this.source.executeCommand(node.handle).catch((err: unknown) => {
            this.host.notifyError(err instanceof Error ? err.message : String(err));
        });
    }

    private toTreeItem(item: IWireTreeItem): ITreeItem {
        const icon = iconOf(item, this.host);
        return {
            label: item.label,
            collapsible: item.collapsibleState !== 0,
            icon: icon?.glyph,
            iconColor: icon?.color,
            description: this.descriptionOf(item),
            actions: this.inlineActions(item),
        };
    }

    /** The command's icon, or its title when it has none (or its glyph is missing from the font set). */
    private inlineActions(item: IWireTreeItem): ITreeItemAction[] {
        return inlineEntries(this.menuGroups(item, true)).map((entry) => ({
            label: entry.label,
            icon: entry.icon === "" ? undefined : entry.icon,
        }));
    }

    /** `undefined` and `""` are no description. */
    private descriptionOf(item: IWireTreeItem): string | undefined {
        if (typeof item.description === "string") return item.description;
        if (item.description === true && item.resourceUri !== undefined) {
            return this.host.relativeDirectory(item.resourceUri);
        }
        return undefined;
    }
}

/** A submenu can't be a glyph: upstream's inline group shows only actions. A group holds no separators. */
function inlineEntries(groups: readonly IMenuEntryGroup[]): IResolvedMenuItemEntry[] {
    return groups.flatMap((group) =>
        group.entries.filter((entry): entry is IResolvedMenuItemEntry => entry.type !== "submenu"),
    );
}

/** Upstream `filterNonUniversalActions` compares action ids: an item by its command, a submenu by its label. */
function hasEntry(groups: readonly IMenuEntryGroup[], entry: ResolvedMenuEntry): boolean {
    const key = entryKey(entry);
    return groups.some((group) => group.entries.some((other) => entryKey(other) === key));
}

/** A group holds items and submenus; separators only come from joining groups. */
function entryKey(entry: ResolvedMenuEntry): string {
    return entry.type === "submenu" ? `submenu:${entry.label}` : `command:${String((entry as MenuItemEntry).id)}`;
}

interface IRowIcon {
    readonly glyph: string;
    readonly color?: string | number;
}

/**
 * Decision 2026-10-24: a `ThemeIcon` is its codicon glyph, its color a theme token; a row with only a
 * `resourceUri` (or `ThemeIcon.File`/`Folder` with one) gets the file icon as in Explorer, where a folder
 * has none; an SVG/PNG `iconPath` can't be drawn in a terminal.
 */
function iconOf(item: IWireTreeItem, host: IExtensionTreeViewHost): IRowIcon | null {
    const themeIcon = item.themeIcon;
    const resourceIcon = themeIcon === undefined || themeIcon.id === "file" || themeIcon.id === "folder";
    if (resourceIcon && item.resourceUri !== undefined) {
        const isFolder = themeIcon === undefined ? item.collapsibleState !== 0 : themeIcon.id === "folder";
        if (isFolder) return null;
        const fileIcon = host.icons.fileIcon(basename(item.resourceUri));
        return fileIcon === undefined ? null : { glyph: fileIcon.icon, color: fileIcon.color };
    }
    if (themeIcon === undefined) return null;
    // `hasOwn`: `toString` is no codicon. A name missing from the Unicode set is `""`, and the tree draws
    // an empty icon as none.
    const glyph = Object.hasOwn(CODICON_GLYPHS, themeIcon.id) ? host.icons.codicon(themeIcon.id) : "";
    const color = themeIcon.color;
    // Stryker disable next-line ConditionalExpression: equivalent — no theme has an `undefined` token, the row is uncolored either way
    return { glyph, color: color !== undefined && host.hasColor(color) ? color : undefined };
}

function basename(uri: string): string {
    const path = Uri.parse(uri).path;
    return path.slice(path.lastIndexOf("/") + 1);
}
