import type {
    IWireTreeItem,
    IWireTreeViewRegistration,
    IWireTreeViewReveal,
    IWireTreeViewTitle,
} from "./treeViewWireTypes.ts";

/** One registered tree in the subprocess, by handle: upstream `ExtHostTreeViewsShape`. */
export interface IExtensionTreeDataSource {
    /** `undefined` — the root. Rejects when the extension's `getChildren`/`getTreeItem` fails. */
    getChildren(parentHandle: string | undefined): Promise<readonly IWireTreeItem[]>;
    /** Rejects with the command's error. */
    executeCommand(handle: string): Promise<void>;
    setVisible(visible: boolean): void;
    setExpanded(handle: string, expanded: boolean): void;
    setSelection(handles: readonly string[], focusedHandle: string | undefined): void;
}

/** Upstream `MainThreadTreeViews`; the requests are already parsed by the host. */
export interface IExtensionTreeViewsSink {
    /** A repeated registration of the id replaces the source and rereads the tree. */
    register(registration: IWireTreeViewRegistration, source: IExtensionTreeDataSource): void;
    unregister(viewId: string): void;
    /** `undefined` — the root; resolves once the tree has reread. */
    refresh(viewId: string, items: readonly IWireTreeItem[] | undefined): Promise<void>;
    reveal(request: IWireTreeViewReveal): Promise<void>;
    setMessage(viewId: string, message: string): void;
    setTitle(title: IWireTreeViewTitle): void;
    /** The subprocess is gone: every tree goes back to an empty section. */
    reset(): void;
}
