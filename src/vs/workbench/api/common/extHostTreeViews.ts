import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import type {
    IWireTreeItem,
    IWireTreeItemHandleArg,
    IWireTreeViewReveal,
    WireTreeItemCollapsibleState,
} from "./treeViewWireTypes.ts";
import type { ExtensionOwner } from "./vscodeHostContext.ts";
import { DisposableImpl, EventEmitter, MarkdownString, ThemeIcon, TreeItemCollapsibleState } from "./vscodeTypes.ts";

/**
 * Upstream `extHostTreeViews.ts`: the extension's elements live only here, the host gets rows by
 * handle (`$getChildren`), and `onDidChangeTreeData` becomes `treeView.refresh` — debounced like
 * upstream (`Event.debounce(…, 200, leading)`): the first change goes at once, the ones that follow
 * within the window go together.
 *
 * Deviations: no drag and drop, checkboxes, `resolveTreeItem` and `activeItem`; `title` reads
 * `undefined` until the extension sets it (upstream starts from the contributed view name, which
 * the host shows anyway).
 */

/** `TreeView.reveal` options (an inline type in `vscode.d.ts`). */
type IRevealOptions = Parameters<vscode.TreeView<unknown>["reveal"]>[1];

const LABEL_HANDLE_PREFIX = "0";
const ID_HANDLE_PREFIX = "1";

/** Upstream's debounce window. */
export const TREE_REFRESH_DELAY_MS = 200;

export interface ITreeViewMembers {
    registerTreeDataProvider: <T>(viewId: string, treeDataProvider: vscode.TreeDataProvider<T>) => vscode.Disposable;
    createTreeView: <T>(viewId: string, options: vscode.TreeViewOptions<T>) => vscode.TreeView<T>;
    /**
     * Upstream's argument processor: a host command argument naming a row (or an array of them, the
     * selection) becomes the provider's element; anything else passes through.
     */
    processArgument: (arg: unknown) => unknown;
}

export interface IExtHostTreeViewsOptions {
    /** `vscode.commands.executeCommand`: a row's command may be the extension's own or the host's. */
    readonly executeCommand: (id: string, ...args: unknown[]) => Thenable<unknown>;
    readonly owner?: ExtensionOwner;
    readonly refreshDelayMs?: number;
}

interface ITreeNode<T> {
    item: IWireTreeItem;
    readonly element: T;
    extensionItem: vscode.TreeItem;
    readonly parent: ITreeNode<T> | undefined;
    children: ITreeNode<T>[] | undefined;
    /** Upstream `_childrenFetchTokens`: the latest fetch of the children; an overtaken one registers nothing. */
    fetchToken: object | undefined;
}

/** The view registered last under the id answers the host (a re-registration replaces it, as upstream). */
export function createExtHostTreeViews(rpc: SubprocessRpc, options: IExtHostTreeViewsOptions): ITreeViewMembers {
    const views = new Map<string, ExtHostTreeView<unknown>>();

    const viewOf = (viewId: string): ExtHostTreeView<unknown> => {
        const view = views.get(viewId);
        if (view === undefined) throw new Error(`No tree view with id '${viewId}' registered.`);
        return view;
    };

    rpc.handleRequest("treeView.getChildren", async (params) => {
        const { viewId, parentHandle } = params as { viewId: string; parentHandle?: string };
        return await viewOf(viewId).getChildren(parentHandle);
    });
    rpc.handleRequest("treeView.executeCommand", async (params) => {
        const { viewId, handle } = params as { viewId: string; handle: string };
        await viewOf(viewId).executeCommand(handle);
        return null;
    });
    // Upstream throws for an unknown view here too; a notification has nobody to throw to.
    rpc.handleNotification("treeView.setVisible", (params) => {
        const { viewId, visible } = params as { viewId: string; visible: boolean };
        views.get(viewId)?.setVisible(visible);
    });
    rpc.handleNotification("treeView.setExpanded", (params) => {
        const { viewId, handle, expanded } = params as { viewId: string; handle: string; expanded: boolean };
        views.get(viewId)?.setExpanded(handle, expanded);
    });
    rpc.handleNotification("treeView.setSelection", (params) => {
        const { viewId, handles } = params as { viewId: string; handles: readonly string[] };
        views.get(viewId)?.setSelection(handles);
    });

    function createTreeView<T>(viewId: string, viewOptions: vscode.TreeViewOptions<T>): vscode.TreeView<T> {
        // The extension's input is not trusted to match the types.
        const given: unknown = (viewOptions as Partial<vscode.TreeViewOptions<T>> | null | undefined)?.treeDataProvider;
        if (given === undefined || given === null) throw new Error("Options with treeDataProvider is mandatory");
        const view = new ExtHostTreeView<T>(viewId, viewOptions.treeDataProvider, rpc, options);
        views.set(viewId, view as ExtHostTreeView<unknown>);
        rpc.notify("treeView.register", {
            viewId,
            showCollapseAll: viewOptions.showCollapseAll === true,
            canSelectMany: viewOptions.canSelectMany === true,
            extensionId: options.owner?.current,
        });
        return view.createApi(() => {
            // A view replaced by a new registration under the same id leaves the new one alone.
            if (views.get(viewId) !== view) return;
            views.delete(viewId);
            rpc.notify("treeView.dispose", { viewId });
        });
    }

    /** Upstream `_convertArgument`: a row the view no longer has, or a view that is gone, is `undefined`. */
    const convertArgument = (arg: IWireTreeItemHandleArg): unknown =>
        views.get(arg.$treeViewId)?.getExtensionElement(arg.$treeItemHandle);

    return {
        processArgument: (arg) => {
            if (isTreeItemHandleArg(arg)) return convertArgument(arg);
            if (Array.isArray(arg)) {
                return arg.map((entry: unknown) => (isTreeItemHandleArg(entry) ? convertArgument(entry) : entry));
            }
            return arg;
        },
        registerTreeDataProvider: <T>(
            viewId: string,
            treeDataProvider: vscode.TreeDataProvider<T>,
        ): vscode.Disposable => {
            const treeView = createTreeView(viewId, { treeDataProvider });
            return new DisposableImpl(() => {
                treeView.dispose();
            });
        },
        createTreeView,
    };
}

class ExtHostTreeView<T> {
    private roots: ITreeNode<T>[] | undefined = undefined;
    private rootFetchToken: object | undefined = undefined;
    private readonly byHandle = new Map<string, ITreeNode<T>>();
    private readonly byElement = new Map<T, ITreeNode<T>>();

    private visible = false;
    private selectedHandles: readonly string[] = [];
    private message = "";
    private title: string | undefined = undefined;
    private description: string | undefined = undefined;
    private badge: vscode.ViewBadge | undefined = undefined;

    private readonly onDidExpandElement = new EventEmitter<vscode.TreeViewExpansionEvent<T>>();
    private readonly onDidCollapseElement = new EventEmitter<vscode.TreeViewExpansionEvent<T>>();
    private readonly onDidChangeSelection = new EventEmitter<vscode.TreeViewSelectionChangeEvent<T>>();
    private readonly onDidChangeVisibility = new EventEmitter<vscode.TreeViewVisibilityChangeEvent>();
    private readonly onDidChangeCheckboxState = new EventEmitter<vscode.TreeCheckboxChangeEvent<T>>();

    /** Changes heard after the leading one in the current debounce window; `undefined` is the root. */
    private pending = new Set<T | undefined>();
    private debounceTimer: ReturnType<typeof setTimeout> | undefined = undefined;
    /** Settles when the refreshes sent so far are applied by the host: `reveal` waits for it. */
    private refreshQueue: Promise<void> = Promise.resolve();
    private readonly dataSubscription: vscode.Disposable | undefined;
    private disposed = false;

    public constructor(
        private readonly viewId: string,
        private readonly provider: vscode.TreeDataProvider<T>,
        private readonly rpc: SubprocessRpc,
        private readonly options: IExtHostTreeViewsOptions,
    ) {
        this.dataSubscription = provider.onDidChangeTreeData?.((change) => {
            // Upstream ignores an empty array: nothing changed.
            if (Array.isArray(change) && change.length === 0) return;
            this.onDidChangeData(change as T | T[] | null | undefined);
        });
    }

    public createApi(unregister: () => void): vscode.TreeView<T> {
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- the API object has its own accessors and needs the view
        const view = this;
        return {
            onDidExpandElement: view.onDidExpandElement.event,
            onDidCollapseElement: view.onDidCollapseElement.event,
            get selection(): readonly T[] {
                return view.selectedElements();
            },
            onDidChangeSelection: view.onDidChangeSelection.event,
            get visible(): boolean {
                return view.visible;
            },
            onDidChangeVisibility: view.onDidChangeVisibility.event,
            onDidChangeCheckboxState: view.onDidChangeCheckboxState.event,
            get message(): string {
                return view.message;
            },
            set message(message: string | undefined) {
                view.message = messageText(message);
                view.rpc.notify("treeView.setMessage", { viewId: view.viewId, message: view.message });
            },
            get title(): string | undefined {
                return view.title;
            },
            set title(title: string | undefined) {
                view.title = title;
                view.notifyTitle();
            },
            get description(): string | undefined {
                return view.description;
            },
            set description(description: string | undefined) {
                view.description = description;
                view.notifyTitle();
            },
            // Kept, never drawn: there is no activity bar to badge.
            get badge(): vscode.ViewBadge | undefined {
                return view.badge;
            },
            set badge(badge: vscode.ViewBadge | undefined) {
                view.badge = badge;
            },
            reveal: (element: T, revealOptions?: IRevealOptions): Thenable<void> => view.reveal(element, revealOptions),
            dispose: (): void => {
                unregister();
                view.dispose();
            },
        };
    }

    public async getChildren(parentHandle: string | undefined): Promise<IWireTreeItem[]> {
        if (parentHandle === undefined) return (this.roots ?? (await this.fetchChildren(undefined))).map(itemOf);
        const parent = this.byHandle.get(parentHandle);
        if (parent === undefined) {
            console.error(`[tree view ${this.viewId}] No tree item with id '${parentHandle}' found.`);
            return [];
        }
        return (parent.children ?? (await this.fetchChildren(parent))).map(itemOf);
    }

    public getExtensionElement(handle: string): T | undefined {
        return this.byHandle.get(handle)?.element;
    }

    public async executeCommand(handle: string): Promise<void> {
        const command = this.byHandle.get(handle)?.extensionItem.command;
        if (command === undefined) return;
        await this.options.executeCommand(command.command, ...((command.arguments ?? []) as unknown[]));
    }

    public setVisible(visible: boolean): void {
        if (this.visible === visible) return;
        this.visible = visible;
        this.onDidChangeVisibility.fire(Object.freeze({ visible }));
    }

    public setExpanded(handle: string, expanded: boolean): void {
        const node = this.byHandle.get(handle);
        if (node === undefined) return;
        const emitter = expanded ? this.onDidExpandElement : this.onDidCollapseElement;
        emitter.fire(Object.freeze({ element: node.element }));
    }

    public setSelection(handles: readonly string[]): void {
        if (sameHandles(this.selectedHandles, handles)) return;
        this.selectedHandles = [...handles];
        this.onDidChangeSelection.fire(Object.freeze({ selection: this.selectedElements() }));
    }

    private selectedElements(): T[] {
        const elements: T[] = [];
        for (const handle of this.selectedHandles) {
            const node = this.byHandle.get(handle);
            if (node !== undefined) elements.push(node.element);
        }
        return elements;
    }

    private notifyTitle(): void {
        this.rpc.notify("treeView.setTitle", { viewId: this.viewId, title: this.title, description: this.description });
    }

    private async reveal(element: T | undefined, revealOptions?: IRevealOptions): Promise<void> {
        const getParent = this.provider.getParent?.bind(this.provider);
        if (getParent === undefined) {
            throw new Error(
                "Required registered TreeDataProvider to implement 'getParent' method to access 'reveal' method",
            );
        }
        const select = revealOptions?.select ?? true;
        const focus = revealOptions?.focus ?? false;
        const expand = revealOptions?.expand ?? false;
        if (element === undefined || element === null) {
            await this.rpc.request("treeView.reveal", { viewId: this.viewId, parentChain: [], select, focus, expand });
            return;
        }
        let request: IWireTreeViewReveal;
        try {
            await this.refreshQueue;
            const parentChain = await this.resolveParentChain(element, getParent);
            const node = await this.resolveTreeNode(element, parentChain.at(-1));
            request = {
                viewId: this.viewId,
                item: node.item,
                parentChain: parentChain.map(itemOf),
                select,
                focus,
                expand,
            };
        } catch (err: unknown) {
            // Upstream logs a chain it can't resolve and resolves the promise.
            console.error(`[tree view ${this.viewId}] reveal failed: ${errorText(err)}`);
            return;
        }
        await this.rpc.request("treeView.reveal", request);
    }

    /** From the root down to the element's parent; `getParent` is the provider's, as upstream asks it. */
    private async resolveParentChain(
        element: T,
        getParent: (element: T) => vscode.ProviderResult<T>,
    ): Promise<ITreeNode<T>[]> {
        const parent = await getParent(element);
        if (parent === undefined || parent === null) return [];
        const chain = await this.resolveParentChain(parent, getParent);
        chain.push(await this.resolveTreeNode(parent, chain.at(-1)));
        return chain;
    }

    private async resolveTreeNode(element: T, parent: ITreeNode<T> | undefined): Promise<ITreeNode<T>> {
        const known = this.byElement.get(element);
        if (known !== undefined) return known;
        const extensionItem = await this.provider.getTreeItem(element);
        const handle = this.createHandle(element, extensionItem, parent);
        // Fetching the parent's children registers the element's node under the very same handle.
        await this.getChildren(parent?.item.handle);
        const node = this.byHandle.get(handle);
        if (node === undefined) throw new Error(`Cannot resolve tree item for element ${handle}`);
        return node;
    }

    /** The parent has no children cached: nothing under it is registered (a failed fetch forgets its rows too). */
    private async fetchChildren(parent: ITreeNode<T> | undefined): Promise<ITreeNode<T>[]> {
        const token = {};
        if (parent === undefined) this.rootFetchToken = token;
        else parent.fetchToken = token;
        const elements = ((await this.provider.getChildren(parent?.element)) ?? []).filter(
            (element): element is T => element !== undefined && element !== null,
        );
        const treeItems = await Promise.all(elements.map(async (element) => this.provider.getTreeItem(element)));
        // A refresh came in while the extension answered: its result is stale, the next request asks again.
        if (!this.isLatestFetch(parent, token)) return [];
        // Synchronous and one by one: a handle counts the siblings registered before it.
        const nodes: ITreeNode<T>[] = [];
        if (parent === undefined) this.roots = nodes;
        else parent.children = nodes;
        try {
            treeItems.forEach((item, index) => {
                nodes.push(this.registerNode(elements[index], item, parent));
            });
        } catch (err: unknown) {
            // Not cached half-built: the rows registered so far are forgotten, the next request asks the
            // extension again.
            this.clearChildren(parent);
            throw err;
        }
        return nodes;
    }

    /** A parent dropped by a refresh in the meantime is no longer in the tree: its fetch is stale too. */
    private isLatestFetch(parent: ITreeNode<T> | undefined, token: object): boolean {
        if (parent === undefined) return this.rootFetchToken === token;
        return parent.fetchToken === token && this.byHandle.get(parent.item.handle) === parent;
    }

    private registerNode(element: T, extensionItem: vscode.TreeItem, parent: ITreeNode<T> | undefined): ITreeNode<T> {
        validateTreeItem(this.viewId, extensionItem);
        const handle = this.createHandle(element, extensionItem, parent);
        const node: ITreeNode<T> = {
            item: toWireItem(handle, parent?.item.handle, extensionItem),
            element,
            extensionItem,
            parent,
            children: undefined,
            fetchToken: undefined,
        };
        // Upstream drops a stale element registered under the same `id` by another object.
        const previous = this.byHandle.get(handle);
        if (previous !== undefined) this.byElement.delete(previous.element);
        this.byHandle.set(handle, node);
        this.byElement.set(element, node);
        return node;
    }

    /**
     * Upstream `_createHandle`: `1/<id>`, or `<parent>/<n>:<label>` with the first free `n` among the siblings.
     * The element's own node is never registered at this point (a refreshed row is unregistered first), so
     * upstream's "its own handle counts as free" and the bound by the sibling count never apply.
     */
    private createHandle(
        element: T,
        { id, label, resourceUri }: vscode.TreeItem,
        parent: ITreeNode<T> | undefined,
    ): string {
        if (typeof id === "string" && id !== "") return `${ID_HANDLE_PREFIX}/${id}`;
        const prefix = parent?.item.handle ?? LABEL_HANDLE_PREFIX;
        // Upstream escapes only the first slash.
        const elementId = (labelText(label) || (resourceUri === undefined ? "" : uriBasename(resourceUri))).replace(
            "/",
            "//",
        );
        for (let counter = 0; ; counter++) {
            const handle = `${prefix}/${counter}:${elementId}`;
            if (!this.byHandle.has(handle)) return handle;
        }
    }

    /** Forgets the subtree under the node (the whole tree for the root), as upstream `_addChildrenToClear`. */
    private clearChildren(parent: ITreeNode<T> | undefined): void {
        if (parent === undefined) {
            this.roots = undefined;
            this.rootFetchToken = undefined;
            this.byHandle.clear();
            this.byElement.clear();
            return;
        }
        if (parent.children === undefined) return;
        for (const child of parent.children) {
            this.clearChildren(child);
            this.byElement.delete(child.element);
            this.byHandle.delete(child.item.handle);
        }
        parent.children = undefined;
    }

    private onDidChangeData(change: T | T[] | null | undefined): void {
        const changed = Array.isArray(change) ? change : [change ?? undefined];
        if (this.debounceTimer === undefined) {
            // Leading edge: the first change of a quiet tree goes at once.
            this.queueRefresh(changed);
        } else {
            for (const element of changed) this.pending.add(element);
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = undefined;
            const pending = this.pending;
            this.pending = new Set();
            // An empty set refreshes nothing.
            this.queueRefresh(pending);
        }, this.options.refreshDelayMs ?? TREE_REFRESH_DELAY_MS);
    }

    private queueRefresh(elements: Iterable<T | undefined>): void {
        const distinct = new Set(elements);
        this.refreshQueue = this.refreshQueue
            .then(() => this.refresh(distinct))
            .catch((err: unknown) => {
                console.error(`[tree view ${this.viewId}] Unable to refresh tree view: ${errorText(err)}`);
            });
    }

    private async refresh(elements: ReadonlySet<T | undefined>): Promise<void> {
        // A change queued just before `dispose()` is not sent.
        if (this.disposed) return;
        if (elements.has(undefined)) {
            this.clearChildren(undefined);
            await this.rpc.request("treeView.refresh", { viewId: this.viewId });
            return;
        }
        const items: IWireTreeItem[] = [];
        for (const node of this.topLevelChanged(elements as ReadonlySet<T>)) {
            await this.refreshNode(node);
            items.push(node.item);
        }
        if (items.length > 0) await this.rpc.request("treeView.refresh", { viewId: this.viewId, items });
    }

    /** Upstream `_getHandlesToRefresh`: unknown elements and those under another changed element drop out. */
    private topLevelChanged(elements: ReadonlySet<T>): ITreeNode<T>[] {
        const changed = new Set<ITreeNode<T>>();
        for (const element of elements) {
            const node = this.byElement.get(element);
            if (node !== undefined) changed.add(node);
        }
        return [...changed].filter((node) => {
            for (let parent = node.parent; parent !== undefined; parent = parent.parent) {
                if (changed.has(parent)) return false;
            }
            return true;
        });
    }

    /** The row is rebuilt in place: the same node, maybe under a new handle, without its children cache. */
    private async refreshNode(node: ITreeNode<T>): Promise<void> {
        const extensionItem = await this.provider.getTreeItem(node.element);
        validateTreeItem(this.viewId, extensionItem);
        this.clearChildren(node);
        this.byHandle.delete(node.item.handle);
        node.item = toWireItem(
            this.createHandle(node.element, extensionItem, node.parent),
            node.parent?.item.handle,
            extensionItem,
        );
        node.extensionItem = extensionItem;
        this.byHandle.set(node.item.handle, node);
    }

    /** The host no longer asks this view; dropping the provider's subscription is all that is left. */
    private dispose(): void {
        this.disposed = true;
        this.dataSubscription?.dispose();
    }
}

/** Upstream `isTreeViewConvertableItem`, without `$focusedTreeItem` (`view/title` gets no row). */
function isTreeItemHandleArg(arg: unknown): arg is IWireTreeItemHandleArg {
    // `null` and `undefined` read as an empty object; a primitive has no such fields either.
    const { $treeViewId, $treeItemHandle } = (arg ?? {}) as Partial<Record<keyof IWireTreeItemHandleArg, unknown>>;
    return typeof $treeViewId === "string" && typeof $treeItemHandle === "string";
}

function itemOf<T>(node: ITreeNode<T>): IWireTreeItem {
    return node.item;
}

function validateTreeItem(viewId: string, extensionItem: vscode.TreeItem): void {
    const value: unknown = extensionItem;
    if (typeof value !== "object" || value === null) {
        throw new Error(`Tree view ${viewId} has provided an invalid tree item.`);
    }
}

function toWireItem(handle: string, parentHandle: string | undefined, item: vscode.TreeItem): IWireTreeItem {
    return {
        handle,
        parentHandle,
        label: labelText(item.label) || (item.resourceUri === undefined ? "" : uriBasename(item.resourceUri)),
        description: typeof item.description === "string" || item.description === true ? item.description : undefined,
        collapsibleState: collapsibleStateOf(item.collapsibleState),
        themeIcon:
            item.iconPath instanceof ThemeIcon ? { id: item.iconPath.id, color: item.iconPath.color?.id } : undefined,
        resourceUri: item.resourceUri?.toString(),
        contextValue: typeof item.contextValue === "string" ? item.contextValue : undefined,
        command:
            item.command === undefined
                ? undefined
                : { id: item.command.command, title: String(item.command.title as unknown) },
    };
}

function collapsibleStateOf(state: vscode.TreeItemCollapsibleState | undefined): WireTreeItemCollapsibleState {
    // The d.ts enum and ours are distinct types with the same values.
    const value = state as number | undefined;
    if (value === (TreeItemCollapsibleState.Collapsed as number)) return 1;
    if (value === (TreeItemCollapsibleState.Expanded as number)) return 2;
    return 0;
}

/** Upstream `toTreeItemLabel`; `highlights` are not drawn. */
function labelText(label: string | vscode.TreeItemLabel | undefined): string {
    const raw: unknown = label;
    if (typeof raw === "string") return raw;
    if (typeof raw !== "object" || raw === null) return "";
    const value: unknown = (raw as { label?: unknown }).label;
    if (typeof value === "string") return value;
    return value instanceof MarkdownString ? value.value : "";
}

function uriBasename(uri: vscode.Uri): string {
    return uri.path.slice(uri.path.lastIndexOf("/") + 1);
}

/** A `MarkdownString` (proposed upstream) is shown as its source text: there is no markdown renderer for a line. */
function messageText(message: unknown): string {
    if (typeof message === "string") return message;
    return message instanceof MarkdownString ? message.value : "";
}

function sameHandles(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((handle, index) => handle === b[index]);
}

function errorText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
