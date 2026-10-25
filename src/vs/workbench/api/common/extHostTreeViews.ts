import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import type {
    IWireThemeIcon,
    IWireTreeItem,
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
}

export interface IExtHostTreeViewsOptions {
    /** `vscode.commands.executeCommand`: a row's command may be the extension's own or the host's. */
    readonly executeCommand: (id: string, ...args: unknown[]) => Thenable<unknown>;
    readonly owner?: ExtensionOwner;
    readonly refreshDelayMs?: number;
}

interface ITreeNode {
    item: IWireTreeItem;
    readonly extensionItem: vscode.TreeItem;
    readonly parent: ITreeNode | undefined;
    children: ITreeNode[] | undefined;
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
        const provider = viewOptions.treeDataProvider;
        const view = new ExtHostTreeView<T>(viewId, provider, rpc, options);
        views.set(viewId, view as ExtHostTreeView<unknown>);
        const extensionId = options.owner?.current;
        rpc.notify("treeView.register", {
            viewId,
            showCollapseAll: viewOptions.showCollapseAll === true,
            canSelectMany: viewOptions.canSelectMany === true,
            ...(extensionId === undefined ? {} : { extensionId }),
        });
        return view.createApi(() => {
            // A view replaced by a new registration under the same id leaves the new one alone.
            if (views.get(viewId) !== view) return;
            views.delete(viewId);
            rpc.notify("treeView.dispose", { viewId });
        });
    }

    return {
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
    private roots: ITreeNode[] | undefined = undefined;
    private readonly elements = new Map<string, T>();
    private readonly nodes = new Map<T, ITreeNode>();
    /** Upstream `_childrenFetchTokens`: a fetch overtaken by a refresh must not register its stale nodes. */
    private readonly fetchTokens = new Map<T | typeof ROOT_FETCH_KEY, number>();
    private fetchCounter = 0;

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

    /** Changes waiting for the debounce window; `undefined` in the list is the root. */
    private pendingElements: (T | undefined)[] = [];
    private debounceTimer: ReturnType<typeof setTimeout> | undefined = undefined;
    /** Changes heard after the leading one in the current window. */
    private debouncedCount = 0;
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
        const parentElement = parentHandle === undefined ? undefined : this.elements.get(parentHandle);
        if (parentHandle !== undefined && parentElement === undefined) {
            console.error(`[tree view ${this.viewId}] No tree item with id '${parentHandle}' found.`);
            return [];
        }
        const cached = parentElement === undefined ? this.roots : this.nodes.get(parentElement)?.children;
        const nodes = cached ?? (await this.fetchChildren(parentElement));
        return nodes.map((node) => node.item);
    }

    public async executeCommand(handle: string): Promise<void> {
        const element = this.elements.get(handle);
        const command = element === undefined ? undefined : this.nodes.get(element)?.extensionItem.command;
        if (command === undefined) return;
        await this.options.executeCommand(command.command, ...((command.arguments ?? []) as unknown[]));
    }

    public setVisible(visible: boolean): void {
        if (this.visible === visible) return;
        this.visible = visible;
        this.onDidChangeVisibility.fire(Object.freeze({ visible }));
    }

    public setExpanded(handle: string, expanded: boolean): void {
        const element = this.elements.get(handle);
        if (element === undefined) return;
        const emitter = expanded ? this.onDidExpandElement : this.onDidCollapseElement;
        emitter.fire(Object.freeze({ element }));
    }

    public setSelection(handles: readonly string[]): void {
        if (sameHandles(this.selectedHandles, handles)) return;
        this.selectedHandles = [...handles];
        this.onDidChangeSelection.fire(Object.freeze({ selection: this.selectedElements() }));
    }

    private selectedElements(): T[] {
        const elements: T[] = [];
        for (const handle of this.selectedHandles) {
            const element = this.elements.get(handle);
            if (element !== undefined) elements.push(element);
        }
        return elements;
    }

    private notifyTitle(): void {
        this.rpc.notify("treeView.setTitle", {
            viewId: this.viewId,
            ...(this.title === undefined ? {} : { title: this.title }),
            ...(this.description === undefined ? {} : { description: this.description }),
        });
    }

    private async reveal(element: T | undefined, revealOptions?: IRevealOptions): Promise<void> {
        if (typeof this.provider.getParent !== "function") {
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
            const parentChain = await this.resolveParentChain(element);
            const node = await this.resolveTreeNode(element, parentChain.at(-1));
            request = {
                viewId: this.viewId,
                item: node.item,
                parentChain: parentChain.map((parent) => parent.item),
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

    /** From the root down to the element's parent. */
    private async resolveParentChain(element: T): Promise<ITreeNode[]> {
        const parent = await this.resolveParent(element);
        if (parent === undefined || parent === null) return [];
        const chain = await this.resolveParentChain(parent);
        chain.push(await this.resolveTreeNode(parent, chain.at(-1)));
        return chain;
    }

    private async resolveParent(element: T): Promise<T | null | undefined> {
        const node = this.nodes.get(element);
        if (node !== undefined)
            return node.parent === undefined ? undefined : this.elements.get(node.parent.item.handle);
        // Checked by `reveal` before the chain is walked.
        return this.provider.getParent?.(element);
    }

    private async resolveTreeNode(element: T, parent: ITreeNode | undefined): Promise<ITreeNode> {
        const known = this.nodes.get(element);
        if (known !== undefined) return known;
        const extensionItem = await this.provider.getTreeItem(element);
        const handle = this.createHandle(element, extensionItem, parent, true);
        // Fetching the parent's children registers the element's node under the very same handle.
        await this.getChildren(parent?.item.handle);
        const cached = this.elements.get(handle);
        const node = cached === undefined ? undefined : this.nodes.get(cached);
        if (node === undefined) throw new Error(`Cannot resolve tree item for element ${handle}`);
        return node;
    }

    private async fetchChildren(parentElement: T | undefined): Promise<ITreeNode[]> {
        this.clearChildren(parentElement);
        const key = parentElement ?? ROOT_FETCH_KEY;
        const token = ++this.fetchCounter;
        this.fetchTokens.set(key, token);
        const elements = ((await this.provider.getChildren(parentElement)) ?? []).filter(
            (element): element is T => element !== undefined && element !== null,
        );
        const treeItems = await Promise.all(elements.map(async (element) => this.provider.getTreeItem(element)));
        // A refresh came in while the extension answered: its result is stale, the next request asks again.
        if (this.fetchTokens.get(key) !== token || this.disposed) return [];
        const parentNode = parentElement === undefined ? undefined : this.nodes.get(parentElement);
        // Synchronous and one by one: a handle counts the siblings registered before it.
        const nodes: ITreeNode[] = [];
        if (parentNode === undefined) {
            this.roots = nodes;
        } else {
            parentNode.children = nodes;
        }
        try {
            treeItems.forEach((item, index) => {
                nodes.push(this.registerNode(elements[index], item, parentNode));
            });
        } catch (err: unknown) {
            // Not cached half-built: the next request asks the extension again.
            if (parentNode === undefined) this.roots = undefined;
            else parentNode.children = undefined;
            throw err;
        }
        return nodes;
    }

    private registerNode(element: T, extensionItem: vscode.TreeItem, parent: ITreeNode | undefined): ITreeNode {
        const node = this.createNode(element, extensionItem, parent);
        // Upstream drops a stale element registered under the same `id` by another object.
        const previous = this.elements.get(node.item.handle);
        if (previous !== undefined && previous !== element) this.nodes.delete(previous);
        this.elements.set(node.item.handle, element);
        this.nodes.set(element, node);
        return node;
    }

    private createNode(element: T, extensionItem: vscode.TreeItem, parent: ITreeNode | undefined): ITreeNode {
        const value: unknown = extensionItem;
        if (typeof value !== "object" || value === null) {
            throw new Error(`Tree view ${this.viewId} has provided an invalid tree item.`);
        }
        const handle = this.createHandle(element, extensionItem, parent);
        return {
            item: toWireItem(handle, parent?.item.handle, extensionItem),
            extensionItem,
            parent,
            children: undefined,
        };
    }

    /** Upstream `_createHandle`: `1/<id>`, or `<parent>/<n>:<label>` with the first free `n` among the siblings. */
    private createHandle(
        element: T,
        { id, label, resourceUri }: vscode.TreeItem,
        parent: ITreeNode | undefined,
        returnFirst = false,
    ): string {
        if (typeof id === "string" && id !== "") return `${ID_HANDLE_PREFIX}/${id}`;
        const prefix = parent?.item.handle ?? LABEL_HANDLE_PREFIX;
        // Upstream escapes only the first slash.
        const elementId = (labelText(label) || (resourceUri === undefined ? "" : uriBasename(resourceUri))).replace(
            "/",
            "//",
        );
        const existing = this.nodes.get(element)?.item.handle;
        const siblings = (parent === undefined ? this.roots : parent.children)?.length ?? 0;
        let handle = `${prefix}/0:${elementId}`;
        for (let counter = 0; counter <= siblings; counter++) {
            handle = `${prefix}/${counter}:${elementId}`;
            if (returnFirst || !this.elements.has(handle) || existing === handle) break;
        }
        return handle;
    }

    /** Forgets the subtree under the element (the whole tree for the root), as upstream `_addChildrenToClear`. */
    private clearChildren(parentElement: T | undefined): void {
        if (parentElement === undefined) {
            this.roots = undefined;
            this.nodes.clear();
            this.elements.clear();
            this.fetchTokens.clear();
            return;
        }
        const node = this.nodes.get(parentElement);
        if (node === undefined) return;
        for (const child of node.children ?? []) {
            const childElement = this.elements.get(child.item.handle);
            if (childElement === undefined) continue;
            this.clearChildren(childElement);
            this.nodes.delete(childElement);
            this.elements.delete(child.item.handle);
            this.fetchTokens.delete(childElement);
        }
        node.children = undefined;
    }

    private onDidChangeData(change: T | T[] | null | undefined): void {
        if (this.disposed) return;
        const changed = Array.isArray(change) ? change : [change === null ? undefined : (change as T | undefined)];
        if (this.debounceTimer === undefined) {
            // Leading edge: the first change of a quiet tree goes at once.
            this.queueRefresh(changed);
        } else {
            this.pendingElements.push(...changed);
            this.debouncedCount++;
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = undefined;
            const pending = this.pendingElements;
            const count = this.debouncedCount;
            this.pendingElements = [];
            this.debouncedCount = 0;
            if (count > 0) this.queueRefresh(pending);
        }, this.options.refreshDelayMs ?? TREE_REFRESH_DELAY_MS);
    }

    private queueRefresh(elements: readonly (T | undefined)[]): void {
        const distinct = [...new Set(elements)];
        this.refreshQueue = this.refreshQueue
            .then(() => this.refresh(distinct))
            .catch((err: unknown) => {
                console.error(`[tree view ${this.viewId}] Unable to refresh tree view: ${errorText(err)}`);
            });
    }

    private async refresh(elements: readonly (T | undefined)[]): Promise<void> {
        if (this.disposed) return;
        if (elements.includes(undefined)) {
            this.clearChildren(undefined);
            await this.rpc.request("treeView.refresh", { viewId: this.viewId });
            return;
        }
        const items: IWireTreeItem[] = [];
        for (const element of this.topLevelChanged(elements as readonly T[])) {
            const node = await this.refreshNode(element);
            if (node !== null) items.push(node.item);
        }
        if (items.length > 0) await this.rpc.request("treeView.refresh", { viewId: this.viewId, items });
    }

    /** Upstream `_getHandlesToRefresh`: unknown elements and those under another changed element drop out. */
    private topLevelChanged(elements: readonly T[]): T[] {
        const changed = new Set(elements.filter((element) => this.nodes.has(element)));
        return [...changed].filter((element) => {
            for (let parent = this.nodes.get(element)?.parent; parent !== undefined; parent = parent.parent) {
                const parentElement = this.elements.get(parent.item.handle);
                if (parentElement !== undefined && changed.has(parentElement)) return false;
            }
            return true;
        });
    }

    private async refreshNode(element: T): Promise<ITreeNode | null> {
        const existing = this.nodes.get(element);
        if (existing === undefined) return null;
        const extensionItem = await this.provider.getTreeItem(element);
        this.clearChildren(element);
        const node = this.createNode(element, extensionItem, existing.parent);
        if (node.item.handle !== existing.item.handle) this.elements.delete(existing.item.handle);
        this.elements.set(node.item.handle, element);
        this.nodes.set(element, node);
        const siblings = existing.parent === undefined ? this.roots : existing.parent.children;
        const index = siblings?.indexOf(existing) ?? -1;
        if (siblings !== undefined && index >= 0) siblings[index] = node;
        return node;
    }

    private dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.dataSubscription?.dispose();
        if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
        this.clearChildren(undefined);
        for (const emitter of [
            this.onDidExpandElement,
            this.onDidCollapseElement,
            this.onDidChangeSelection,
            this.onDidChangeVisibility,
            this.onDidChangeCheckboxState,
        ]) {
            emitter.dispose();
        }
    }
}

const ROOT_FETCH_KEY = Symbol("treeViewRoot");

function toWireItem(handle: string, parentHandle: string | undefined, item: vscode.TreeItem): IWireTreeItem {
    const resourceUri = item.resourceUri?.toString();
    const label = labelText(item.label) || (item.resourceUri === undefined ? "" : uriBasename(item.resourceUri));
    const description =
        typeof item.description === "string" || item.description === true ? item.description : undefined;
    const themeIcon = item.iconPath instanceof ThemeIcon ? toWireThemeIcon(item.iconPath) : undefined;
    return {
        handle,
        ...(parentHandle === undefined ? {} : { parentHandle }),
        label,
        ...(description === undefined ? {} : { description }),
        collapsibleState: collapsibleStateOf(item.collapsibleState),
        ...(themeIcon === undefined ? {} : { themeIcon }),
        ...(resourceUri === undefined ? {} : { resourceUri }),
        ...(typeof item.contextValue === "string" ? { contextValue: item.contextValue } : {}),
        ...(item.command === undefined
            ? {}
            : { command: { id: item.command.command, title: String(item.command.title as unknown) } }),
    };
}

function collapsibleStateOf(state: vscode.TreeItemCollapsibleState | undefined): WireTreeItemCollapsibleState {
    // The d.ts enum and ours are distinct types with the same values.
    const value = state as number | undefined;
    if (value === (TreeItemCollapsibleState.Collapsed as number)) return 1;
    if (value === (TreeItemCollapsibleState.Expanded as number)) return 2;
    return 0;
}

function toWireThemeIcon(icon: ThemeIcon): IWireThemeIcon {
    const color = icon.color?.id;
    return typeof color === "string" ? { id: icon.id, color } : { id: icon.id };
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
    const segments = uri.path.split("/");
    return segments.at(-1) ?? "";
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
