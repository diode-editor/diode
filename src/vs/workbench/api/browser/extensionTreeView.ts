import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import type { ITreeDataProvider, ITreeItem } from "@tuidom/elements/tree/iTreeDataProvider";
import { TreeViewElement } from "@tuidom/elements/tree/treeViewElement";

import { CODICON_GLYPHS } from "../../../base/common/codicons.generated.ts";
import { getFileIcon } from "../../../base/common/fileIcons.ts";
import { Uri } from "../../../base/common/uri.ts";
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

const NO_CHILDREN: readonly IExtensionTreeNode[] = [];

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
            if (isExpanded) this.expanded.set(node.handle, node);
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
    }

    public setMessage(message: string): void {
        this.message.setText(message);
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

    private async loadChildren(parent: IExtensionTreeNode | undefined): Promise<IExtensionTreeNode[]> {
        const key = parent?.handle ?? "";
        if (this.underFailure(parent)) return [...(this.lastChildren.get(key) ?? NO_CHILDREN)];
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

    /** The root or an ancestor of the row failed in this reread. */
    private underFailure(node: IExtensionTreeNode | undefined): boolean {
        if (node === undefined) return false;
        if (this.failed.has("")) return true;
        for (let current = node; ; ) {
            const parentHandle = current.item.parentHandle;
            if (parentHandle === undefined) return false;
            if (this.failed.has(parentHandle)) return true;
            const parent = this.nodes.get(parentHandle);
            // Stryker disable next-line ConditionalExpression: equivalent — every listed row's parent is listed too
            if (parent === undefined) return false;
            current = parent;
        }
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
        const icon = iconOf(item, (token) => this.host.hasColor(token));
        return {
            label: item.label,
            collapsible: item.collapsibleState !== 0,
            icon: icon?.glyph,
            iconColor: icon?.color,
            description: this.descriptionOf(item),
        };
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
    const color = themeIcon.color;
    return { glyph, color: color !== undefined && hasColor(color) ? color : undefined };
}

function basename(uri: string): string {
    const path = Uri.parse(uri).path;
    return path.slice(path.lastIndexOf("/") + 1);
}
