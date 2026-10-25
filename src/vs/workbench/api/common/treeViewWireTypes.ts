// Tree view wire types (upstream `ITreeItem`/`MainThreadTreeViewsShape` in `extHost.protocol.ts`); the host
// parses them in `services/extensions/node/treeViewWireParsers.ts`.

/** `vscode.TreeItemCollapsibleState`: 0 — a leaf, 1 — collapsed, 2 — expanded on first show. */
export type WireTreeItemCollapsibleState = 0 | 1 | 2;

/** `color` is the `ThemeColor` id, a theme token name. */
export interface IWireThemeIcon {
    readonly id: string;
    readonly color?: string;
}

/**
 * One row, as upstream: the extension's element never leaves the subprocess, the host knows it by `handle`
 * (`1/<TreeItem.id>` or a generated `<parentHandle>/<index>:<label>`).
 */
export interface IWireTreeItem {
    readonly handle: string;
    readonly parentHandle?: string;
    /** Already resolved: `TreeItemLabel.label`, or the `resourceUri` basename when there is no label. */
    readonly label: string;
    /** `true` is upstream's "the `resourceUri` path": the host renders it relative to the workspace. */
    readonly description?: string | boolean;
    readonly collapsibleState: WireTreeItemCollapsibleState;
    readonly themeIcon?: IWireThemeIcon;
    /** `uri.toString()`. */
    readonly resourceUri?: string;
    readonly contextValue?: string;
    /** Only the title: the command runs in the subprocess (`treeView.executeCommand`), its arguments stay there. */
    readonly command?: { readonly id: string; readonly title: string };
}

/** Upstream `$registerTreeViewDataProvider` options; drag and drop and checkboxes are not supported. */
export interface IWireTreeViewRegistration {
    readonly viewId: string;
    readonly showCollapseAll: boolean;
    readonly canSelectMany: boolean;
    /** Who registered: the host names it in an Output line about a view that is not contributed. */
    readonly extensionId?: string;
}

export interface IWireTreeViewId {
    readonly viewId: string;
}

/** No `items`: the root is reread. With `items`: their rows are replaced and their subtrees reread. */
export interface IWireTreeViewRefresh {
    readonly viewId: string;
    readonly items?: readonly IWireTreeItem[];
}

export interface IWireTreeViewMessage {
    readonly viewId: string;
    readonly message: string;
}

export interface IWireTreeViewTitle {
    readonly viewId: string;
    readonly title?: string;
    readonly description?: string;
}

/** Upstream `$reveal`: `item` with its ancestors from the root; no `item` — only focus/selection of the view. */
export interface IWireTreeViewReveal {
    readonly viewId: string;
    readonly item?: IWireTreeItem;
    readonly parentChain: readonly IWireTreeItem[];
    readonly select: boolean;
    readonly focus: boolean;
    /** `true` or a number of levels below the item, as `TreeView.reveal`'s `expand`. */
    readonly expand: boolean | number;
}

/** No `parentHandle` — the root. */
export interface IWireTreeViewGetChildren {
    readonly viewId: string;
    readonly parentHandle?: string;
}

export interface IWireTreeViewItemRef {
    readonly viewId: string;
    readonly handle: string;
}

export interface IWireTreeViewVisibility {
    readonly viewId: string;
    readonly visible: boolean;
}

export interface IWireTreeViewExpansion {
    readonly viewId: string;
    readonly handle: string;
    readonly expanded: boolean;
}

export interface IWireTreeViewSelection {
    readonly viewId: string;
    readonly handles: readonly string[];
    readonly focusedHandle?: string;
}
