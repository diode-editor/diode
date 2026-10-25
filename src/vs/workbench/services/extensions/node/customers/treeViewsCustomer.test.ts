import { describe, expect, it } from "vitest";

import { flushMicrotasks } from "../../../../../../TestUtils/timing.ts";
import type { SubprocessRpc } from "../../../../api/common/extHostProtocol.ts";
import type {
    IExtensionTreeDataSource,
    IExtensionTreeViewsSink,
} from "../../../../api/common/iExtensionTreeViewsSink.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import type { IWireTreeItem } from "../../../../api/common/treeViewWireTypes.ts";

import { TreeViewsCustomer } from "./treeViewsCustomer.ts";

function recordingSink() {
    const calls: unknown[][] = [];
    const sources: IExtensionTreeDataSource[] = [];
    const sink: IExtensionTreeViewsSink = {
        register: (registration, source) => {
            calls.push(["register", registration]);
            sources.push(source);
        },
        unregister: (viewId) => calls.push(["unregister", viewId]),
        refresh: (viewId, items) => {
            calls.push(["refresh", viewId, items]);
            return Promise.resolve();
        },
        reveal: (request) => {
            calls.push(["reveal", request]);
            return Promise.resolve();
        },
        setMessage: (viewId, message) => calls.push(["message", viewId, message]),
        setTitle: (title) => calls.push(["title", title]),
        reset: () => calls.push(["reset"]),
    };
    return { sink, calls, sources };
}

function setup(sink: IExtensionTreeViewsSink | undefined) {
    const [a, b] = createInProcessChannelPair();
    const peer = new RpcEndpoint(b) as unknown as SubprocessRpc;
    const spawn = new TreeViewsCustomer(sink).attach({ rpc: new RpcEndpoint(a), logger: undefined });
    return { peer, spawn };
}

describe("TreeViewsCustomer", () => {
    it("register hands the sink a source that talks to this very view", async () => {
        const { sink, calls, sources } = recordingSink();
        const { peer } = setup(sink);
        const seen: unknown[] = [];
        peer.handleRequest("treeView.getChildren", (params) => {
            seen.push(["children", params]);
            return [{ handle: "h", label: "l", collapsibleState: 0 }, { label: "no handle" }] as IWireTreeItem[];
        });
        peer.handleRequest("treeView.executeCommand", (params) => {
            seen.push(["execute", params]);
            return null;
        });
        for (const method of ["treeView.setVisible", "treeView.setExpanded", "treeView.setSelection"] as const) {
            peer.handleNotification(method, (params) => seen.push([method, params]));
        }
        peer.notify("treeView.register", { viewId: "v", showCollapseAll: true, canSelectMany: false });
        peer.notify("treeView.register", { viewId: "" } as never);
        await flushMicrotasks();
        expect(calls).toEqual([["register", { viewId: "v", showCollapseAll: true, canSelectMany: false }]]);

        const source = sources[0];
        expect(await source.getChildren(undefined)).toEqual([{ handle: "h", label: "l", collapsibleState: 0 }]);
        await source.getChildren("h");
        await source.executeCommand("h");
        source.setVisible(true);
        source.setExpanded("h", false);
        source.setSelection(["h"], "h");
        source.setSelection([], undefined);
        await flushMicrotasks();
        expect(seen).toEqual([
            ["children", { viewId: "v" }],
            ["children", { viewId: "v", parentHandle: "h" }],
            ["execute", { viewId: "v", handle: "h" }],
            ["treeView.setVisible", { viewId: "v", visible: true }],
            ["treeView.setExpanded", { viewId: "v", handle: "h", expanded: false }],
            ["treeView.setSelection", { viewId: "v", handles: ["h"], focusedHandle: "h" }],
            ["treeView.setSelection", { viewId: "v", handles: [] }],
        ]);
    });

    it("dispose, refresh, reveal, message and title reach the sink; malformed ones don't", async () => {
        const { sink, calls } = recordingSink();
        const { peer } = setup(sink);
        peer.notify("treeView.dispose", { viewId: "v" });
        peer.notify("treeView.dispose", {} as never);
        expect(await peer.request("treeView.refresh", { viewId: "v" })).toBeNull();
        expect(await peer.request("treeView.refresh", { viewId: "v", items: "x" } as never)).toBeNull();
        expect(
            await peer.request("treeView.reveal", {
                viewId: "v",
                parentChain: [],
                select: true,
                focus: false,
                expand: false,
            }),
        ).toBeNull();
        expect(await peer.request("treeView.reveal", {} as never)).toBeNull();
        peer.notify("treeView.setMessage", { viewId: "v", message: "m" });
        peer.notify("treeView.setMessage", { viewId: "v" } as never);
        peer.notify("treeView.setTitle", { viewId: "v", title: "T" });
        peer.notify("treeView.setTitle", {} as never);
        await flushMicrotasks();
        expect(calls).toEqual([
            ["unregister", "v"],
            ["refresh", "v", undefined],
            ["reveal", { viewId: "v", parentChain: [], select: true, focus: false, expand: false }],
            ["message", "v", "m"],
            ["title", { viewId: "v", title: "T" }],
        ]);
    });

    it("the spawn's end resets every tree", () => {
        const { sink, calls } = recordingSink();
        const { spawn } = setup(sink);
        spawn.dispose();
        expect(calls).toEqual([["reset"]]);
    });

    it("without a sink the subprocess still gets answers to refresh and reveal", async () => {
        const { peer } = setup(undefined);
        expect(await peer.request("treeView.refresh", { viewId: "v" })).toBeNull();
        expect(
            await peer.request("treeView.reveal", {
                viewId: "v",
                parentChain: [],
                select: true,
                focus: false,
                expand: false,
            }),
        ).toBeNull();
    });
});
