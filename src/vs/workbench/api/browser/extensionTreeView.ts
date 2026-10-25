import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import type { ITreeDataProvider, ITreeItem } from "@tuidom/elements/tree/iTreeDataProvider";
import { TreeViewElement } from "@tuidom/elements/tree/treeViewElement";

import { CODICON_GLYPHS } from "../../../base/common/codicons.generated.ts";
import { getFileIcon } from "../../../base/common/fileIcons.ts";
import type { ILogger } from "../../../platform/log/common/iLogger.ts";
import { HeaderBodyViewElement } from "../../browser/parts/views/headerBodyViewElement.ts";
import { ViewMessageElement } from "../../browser/parts/views/viewMessageElement.ts";
import type { IExtensionTreeDataSource } from "../common/iExtensionTreeViewsSink.ts";
import type { IWireTreeItem, IWireTreeViewReveal } from "../common/treeViewWireTypes.ts";

/** What a tree needs from the workbench; the adapter wires it to the services. */
export interface IExtensionTreeViewHost {
    /** `workbench.list.openMode`/`workbench.tree.expandMode`, read on every gesture as Explorer does. */
    readonly openOnSingleClick: () => boolean;
    readonly expandOnRowClick: () => boolean;
    /** Upstream `notificationService.error` for a row command that failed. */
    notifyError(message: string): void;
    /**
     * A `ThemeIcon` color is a token of the theme only if the theme has it: an unknown token (an
     * extension's own `contributes.colors`) would throw in the frame.
     */
    hasColor(token: string): boolean;
    /** `description: true`: the folder of the resource relative to its workspace folder, `""` at its root. */
    relativeDirectory(uri: string): string;
    readonly logger?: ILogger;
}

/** The host's row: the handle is the key, the item is replaced in place on refresh, so the tree holds one object. */
export interface IExtensionTreeNode {
    readonly handle: string;
    item: IWireTreeItem;
}

/** Upstream `TreeItemCollapsibleState.Expanded`. */
const EXPANDED = 2;

/**
 * Upstream `CustomTreeView`: the section body of a contributed view whose extension registered a tree.
 * Rows come by handle from the subprocess ({@link IExtensionTreeDataSource}); the root is read when the
 * section is visible, children when a node expands. A refresh keeps the old rows until the answer
 * arrives, and expansion and the cursor survive it by handle (the tree's key).
 */
export class ExtensionTreeView {
    public readonly view: TUIElement;
    private readonly tree: TreeViewElement<IExtensionTreeNode>;
    private readonly message = new ViewMessageElement();
    private source: IExtensionTreeDataSource;
    private canSelectMany: boolean;
    private readonly nodes = new Map<string, IExtensionTreeNode>();
    /** The last answer per parent (`""` is the root): a failed request leaves the rows that were there. */
    private readonly lastChildren = new Map<string, IExtensionTreeNode[]>();
    /** `Expanded` applies when a row first appears, not on every reread. */
    private readonly seen = new Set<string>();
    /** For Collapse All: the tree keeps its expansion private. */
    private readonly expanded = new Set<string>();
    private visible = false;
    /** The root has to be (re)read the next time the section is visible. */
    private stale = true;
    private loading: Promise<void> | null = null;
    private disposed = false;

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
        });
        const scrollBars = new ScrollBarDecorator(this.tree);
        scrollBars.style = { fg: "sideBar.foreground", bg: "sideBar.background" };
        this.view = new HeaderBodyViewElement(this.message, scrollBars);
        this.view.id = `extensionTreeView-${viewId.replaceAll(".", "-")}`;

        this.tree.onActivate = (node) => {
            this.runCommand(node);
        };
        this.tree.onExpandedChanged = (node, isExpanded) => {
            if (isExpanded) this.expanded.add(node.handle);
            else this.expanded.delete(node.handle);
            this.source.setExpanded(node.handle, isExpanded);
        };
        this.tree.onSelect = (node) => {
            const selected = this.canSelectMany ? this.tree.getSelectedNodes() : [node];
            this.source.setSelection(
                selected.map((entry) => entry.handle),
                node.handle,
            );
        };
    }

    /** A repeated registration: the new provider answers, the tree rereads, expansion stays by handle. */
    public setSource(source: IExtensionTreeDataSource, options: { readonly canSelectMany: boolean }): void {
        this.source = source;
        this.canSelectMany = options.canSelectMany;
        this.lastChildren.clear();
        // The new subprocess-side view starts hidden: tell it the truth.
        if (this.visible) source.setVisible(true);
        this.refreshRoot();
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
            this.refreshRoot();
            await this.loading;
            return;
        }
        const changed: IExtensionTreeNode[] = [];
        for (const item of items) {
            const node = this.nodes.get(item.handle);
            if (node === undefined) continue;
            node.item = item;
            changed.push(node);
        }
        if (this.stale) return;
        for (const node of changed) await this.tree.refresh(node);
    }

    public setMessage(message: string): void {
        this.message.setText(message);
    }

    public getMessage(): string {
        return this.message.getText();
    }

    /** Upstream `CollapseAllAction`. */
    public async collapseAll(): Promise<void> {
        for (const handle of [...this.expanded]) {
            const node = this.nodes.get(handle);
            if (node !== undefined && this.expanded.has(handle)) await this.tree.toggleExpand(node);
        }
    }

    public focus(): void {
        this.tree.focus();
    }

    public get treeElement(): TreeViewElement<IExtensionTreeNode> {
        return this.tree;
    }

    /** The section was opened by the caller; this expands the ancestors, places the cursor and expands the item. */
    public async reveal(request: IWireTreeViewReveal): Promise<void> {
        if (this.stale || this.loading !== null) await this.loadRoot();
        if (request.item !== undefined) {
            const chain = [...request.parentChain, request.item].map((item) => this.nodeFor(item));
            await this.tree.reveal(chain);
            const target = chain[chain.length - 1];
            const levels = request.expand === true ? 1 : request.expand === false ? 0 : request.expand;
            await this.expandLevels([target], levels);
        }
        if (request.focus) this.focus();
    }

    public dispose(): void {
        this.disposed = true;
    }

    private async expandLevels(nodes: readonly IExtensionTreeNode[], levels: number): Promise<void> {
        if (levels <= 0 || nodes.length === 0) return;
        const collapsible = nodes.filter((node) => node.item.collapsibleState !== 0);
        await this.tree.expandElements(collapsible);
        const children = collapsible.flatMap((node) => this.lastChildren.get(node.handle) ?? []);
        await this.expandLevels(children, levels - 1);
    }

    private refreshRoot(): void {
        this.stale = true;
        if (this.visible) void this.loadRoot();
    }

    private loadRoot(): Promise<void> {
        this.stale = false;
        const load = this.tree.refresh().finally(() => {
            if (this.loading === load) this.loading = null;
        });
        this.loading = load;
        return load;
    }

    private async loadChildren(parent: IExtensionTreeNode | undefined): Promise<IExtensionTreeNode[]> {
        const key = parent?.handle ?? "";
        const source = this.source;
        let items: readonly IWireTreeItem[];
        try {
            items = await source.getChildren(parent?.handle);
        } catch (err: unknown) {
            this.host.logger?.error(`tree view "${this.viewId}": ${err instanceof Error ? err.message : String(err)}`);
            return this.lastChildren.get(key) ?? [];
        }
        // A newer registration replaced the provider while this one answered.
        if (source !== this.source || this.disposed) return this.lastChildren.get(key) ?? [];
        const children = items.map((item) => this.nodeFor(item));
        this.lastChildren.set(key, children);
        const firstExpanded = children.filter((node) => {
            const fresh = !this.seen.has(node.handle);
            this.seen.add(node.handle);
            return fresh && node.item.collapsibleState === EXPANDED;
        });
        // After the tree has taken these children: it expands a row it already lists.
        if (firstExpanded.length > 0) {
            queueMicrotask(() => {
                void this.tree.expandElements(firstExpanded);
            });
        }
        return children;
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
        const command = node.item.command;
        if (command === undefined) return;
        this.source.executeCommand(node.handle).catch((err: unknown) => {
            this.host.notifyError(err instanceof Error ? err.message : String(err));
        });
    }

    private toTreeItem(item: IWireTreeItem): ITreeItem {
        const description = this.descriptionOf(item);
        const icon = iconOf(item, (token) => this.host.hasColor(token));
        return {
            label: item.label,
            collapsible: item.collapsibleState !== 0,
            ...(icon === null
                ? {}
                : { icon: icon.glyph, ...(icon.color === undefined ? {} : { iconColor: icon.color }) }),
            ...(description === "" ? {} : { description }),
        };
    }

    private descriptionOf(item: IWireTreeItem): string {
        if (typeof item.description === "string") return item.description;
        if (item.description === true && item.resourceUri !== undefined) {
            return this.host.relativeDirectory(item.resourceUri);
        }
        return "";
    }
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
function iconOf(item: IWireTreeItem, hasColor: (token: string) => boolean): IRowIcon | null {
    const themeIcon = item.themeIcon;
    const resourceIcon = themeIcon === undefined || themeIcon.id === "file" || themeIcon.id === "folder";
    if (resourceIcon && item.resourceUri !== undefined) {
        const isFolder = themeIcon === undefined ? item.collapsibleState !== 0 : themeIcon.id === "folder";
        if (isFolder) return null;
        const fileIcon = getFileIcon(basename(item.resourceUri));
        return { glyph: fileIcon.icon, color: fileIcon.color };
    }
    if (themeIcon === undefined) return null;
    const glyph = Object.hasOwn(CODICON_GLYPHS, themeIcon.id) ? CODICON_GLYPHS[themeIcon.id] : undefined;
    if (glyph === undefined) return null;
    return themeIcon.color !== undefined && hasColor(themeIcon.color) ? { glyph, color: themeIcon.color } : { glyph };
}

function basename(uri: string): string {
    const path = uri.replace(/[?#].*$/u, "");
    return decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
}
