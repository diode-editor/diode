import { describe, expect, it } from "vitest";

import { flushMicrotasks } from "../../../../../../TestUtils/timing.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import type { IWireUpdateWorkspaceFolders } from "../../../../api/common/wireTypes.ts";
import type { IExtensionHostContext } from "../../common/extensionHostCustomer.ts";
import { parseWireUpdateWorkspaceFolders } from "../hostWireParsers.ts";

import { WorkspaceFoldersCustomer } from "./workspaceFoldersCustomer.ts";

function attach(withSink: boolean) {
    const [a, b] = createInProcessChannelPair();
    const warnings: string[] = [];
    const logger = {
        trace: () => undefined,
        debug: () => undefined,
        info: () => undefined,
        warn: (message: string) => warnings.push(message),
        error: () => undefined,
    } as never;
    const hostRpc = new RpcEndpoint(a, logger) as unknown as HostRpc;
    const peer = new RpcEndpoint(b);
    const requests: IWireUpdateWorkspaceFolders[] = [];
    const customer = new WorkspaceFoldersCustomer(
        withSink ? { update: (request) => requests.push(request) } : undefined,
    );
    const subscription = customer.attach({ rpc: hostRpc } as unknown as IExtensionHostContext);
    return { peer, requests, warnings, subscription };
}

describe("WorkspaceFoldersCustomer", () => {
    it("an extension request reaches the sink", async () => {
        const { peer, requests } = attach(true);
        peer.notify("workspace.updateWorkspaceFolders", { extensionId: "golang.go", folders: ["/a", "/b"] });
        await flushMicrotasks();
        expect(requests).toEqual([{ extensionId: "golang.go", folders: ["/a", "/b"] }]);
    });

    it("junk and a missing sink crash nothing", async () => {
        const withSink = attach(true);
        withSink.peer.notify("workspace.updateWorkspaceFolders", null);
        await flushMicrotasks();
        expect(withSink.requests).toEqual([]);
        expect(withSink.warnings).toEqual([]);

        const bare = attach(false);
        bare.peer.notify("workspace.updateWorkspaceFolders", { extensionId: null, folders: ["/a"] });
        await flushMicrotasks();
        expect(bare.warnings).toEqual([]);
    });

    it("requests are not accepted after unsubscribe", async () => {
        const { peer, requests, subscription } = attach(true);
        subscription.dispose();
        peer.notify("workspace.updateWorkspaceFolders", { extensionId: null, folders: ["/a"] });
        await flushMicrotasks();
        expect(requests).toEqual([]);
    });
});

describe("parseWireUpdateWorkspaceFolders", () => {
    it("paths and extension id; without id — null", () => {
        expect(parseWireUpdateWorkspaceFolders({ extensionId: "x", folders: ["/a"] })).toEqual({
            extensionId: "x",
            folders: ["/a"],
        });
        expect(parseWireUpdateWorkspaceFolders({ extensionId: 5, folders: [] })).toEqual({
            extensionId: null,
            folders: [],
        });
    });

    it("a non-array or a non-string among paths — a foreign request", () => {
        expect(parseWireUpdateWorkspaceFolders(null)).toBeNull();
        expect(parseWireUpdateWorkspaceFolders({ folders: "/a" })).toBeNull();
        expect(parseWireUpdateWorkspaceFolders({ folders: ["/a", 5] })).toBeNull();
    });
});
