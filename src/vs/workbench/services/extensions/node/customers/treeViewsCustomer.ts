import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import type {
    IExtensionTreeDataSource,
    IExtensionTreeViewsSink,
} from "../../../../api/common/iExtensionTreeViewsSink.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import {
    parseWireTreeItems,
    parseWireTreeViewId,
    parseWireTreeViewMessage,
    parseWireTreeViewRefresh,
    parseWireTreeViewRegistration,
    parseWireTreeViewReveal,
    parseWireTreeViewTitle,
} from "../treeViewWireParsers.ts";

/**
 * Upstream `MainThreadTreeViews`. The trees belong to the spawn: on death every section goes back to
 * empty, and a revived extension registers its trees again on activation.
 */
export class TreeViewsCustomer implements IExtensionHostCustomer {
    public constructor(private readonly sink: IExtensionTreeViewsSink | undefined) {}

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        const store = new DisposableStore();
        const sink = this.sink;
        // Without a sink the subprocess still gets an answer: `reveal` and a refresh chain wait on it.
        if (sink === undefined) {
            store.add(rpc.handleRequest("treeView.refresh", () => null));
            store.add(rpc.handleRequest("treeView.reveal", () => null));
            return store;
        }
        store.add(
            rpc.handleNotification("treeView.register", (params) => {
                const registration = parseWireTreeViewRegistration(params);
                if (registration !== null) sink.register(registration, dataSource(rpc, registration.viewId));
            }),
        );
        store.add(
            rpc.handleNotification("treeView.dispose", (params) => {
                const viewId = parseWireTreeViewId(params);
                if (viewId !== null) sink.unregister(viewId);
            }),
        );
        store.add(
            rpc.handleRequest("treeView.refresh", async (params) => {
                const request = parseWireTreeViewRefresh(params);
                if (request !== null) await sink.refresh(request.viewId, request.items);
                return null;
            }),
        );
        store.add(
            rpc.handleRequest("treeView.reveal", async (params) => {
                const request = parseWireTreeViewReveal(params);
                if (request !== null) await sink.reveal(request);
                return null;
            }),
        );
        store.add(
            rpc.handleNotification("treeView.setMessage", (params) => {
                const request = parseWireTreeViewMessage(params);
                if (request !== null) sink.setMessage(request.viewId, request.message);
            }),
        );
        store.add(
            rpc.handleNotification("treeView.setTitle", (params) => {
                const request = parseWireTreeViewTitle(params);
                if (request !== null) sink.setTitle(request);
            }),
        );
        store.add({
            dispose: () => {
                sink.reset();
            },
        });
        return store;
    }
}

function dataSource(rpc: HostRpc, viewId: string): IExtensionTreeDataSource {
    return {
        getChildren: async (parentHandle) =>
            parseWireTreeItems(
                await rpc.request("treeView.getChildren", {
                    viewId,
                    ...(parentHandle === undefined ? {} : { parentHandle }),
                }),
            ),
        executeCommand: async (handle) => {
            await rpc.request("treeView.executeCommand", { viewId, handle });
        },
        setVisible: (visible) => {
            rpc.notify("treeView.setVisible", { viewId, visible });
        },
        setExpanded: (handle, expanded) => {
            rpc.notify("treeView.setExpanded", { viewId, handle, expanded });
        },
        setSelection: (handles, focusedHandle) => {
            rpc.notify("treeView.setSelection", {
                viewId,
                handles,
                ...(focusedHandle === undefined ? {} : { focusedHandle }),
            });
        },
    };
}
