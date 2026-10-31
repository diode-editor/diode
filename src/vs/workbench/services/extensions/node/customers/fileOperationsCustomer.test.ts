import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../../TestUtils/timing.ts";
import type { SubprocessRpc } from "../../../../api/common/extHostProtocol.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import type { IWireFileOperationParams } from "../../../../api/common/wireTypes.ts";

import { FileOperationsCustomer } from "./fileOperationsCustomer.ts";

const PARAMS: IWireFileOperationParams = {
    operation: "move",
    files: [{ source: "file:///a", target: "file:///b" }],
    timeoutMs: 1000,
};

function setup() {
    const customer = new FileOperationsCustomer(undefined);
    const [a, b] = createInProcessChannelPair();
    const peer: SubprocessRpc = new RpcEndpoint(b);
    const spawn = customer.attach({ rpc: new RpcEndpoint(a), logger: undefined });
    return { customer, peer, spawn };
}

async function subscribe(peer: SubprocessRpc): Promise<void> {
    peer.notify("workspace.updateFileOperationSubscriptions", { will: true });
    await flushMicrotasks();
}

describe("FileOperationsCustomer", () => {
    it("without a subprocess there is nothing to wait for and nobody to tell", async () => {
        const customer = new FileOperationsCustomer(undefined);
        await expect(customer.willRunFileOperation(PARAMS)).resolves.toEqual([]);
        expect(() => {
            customer.didRunFileOperation(PARAMS);
        }).not.toThrow();
    });

    it("without will listeners the subprocess isn't asked", async () => {
        const { customer, peer } = setup();
        const handler = vi.fn(() => []);
        peer.handleRequest("workspace.willRunFileOperation", handler);

        await expect(customer.willRunFileOperation(PARAMS)).resolves.toEqual([]);

        expect(handler).not.toHaveBeenCalled();
    });

    it("with will listeners it sends the request and returns the parsed edit", async () => {
        const { customer, peer } = setup();
        const handler = vi.fn(() => [{ kind: "delete" as const, resource: "file:///x" }]);
        peer.handleRequest("workspace.willRunFileOperation", handler);
        await subscribe(peer);

        await expect(customer.willRunFileOperation(PARAMS)).resolves.toEqual([
            { kind: "delete", resource: "file:///x" },
        ]);

        expect(handler).toHaveBeenCalledWith(PARAMS, expect.anything());
    });

    it("a listener going away stops the requests", async () => {
        const { customer, peer } = setup();
        const handler = vi.fn(() => []);
        peer.handleRequest("workspace.willRunFileOperation", handler);
        await subscribe(peer);
        peer.notify("workspace.updateFileOperationSubscriptions", { will: false });
        await flushMicrotasks();

        await customer.willRunFileOperation(PARAMS);

        expect(handler).not.toHaveBeenCalled();
    });

    it("the timeout is the operation's: past it there are no edits and the call doesn't reject", async () => {
        const { customer, peer } = setup();
        peer.handleRequest("workspace.willRunFileOperation", () => new Promise(() => undefined));
        await subscribe(peer);

        await expect(customer.willRunFileOperation({ ...PARAMS, timeoutMs: 1 })).resolves.toEqual([]);
    });

    it("a failed request is no edits", async () => {
        const { customer, peer } = setup();
        peer.handleRequest("workspace.willRunFileOperation", () => {
            throw new Error("extension host bug");
        });
        await subscribe(peer);

        await expect(customer.willRunFileOperation(PARAMS)).resolves.toEqual([]);
    });

    it("a malformed reply is no edits", async () => {
        const { customer, peer } = setup();
        peer.handleRequest("workspace.willRunFileOperation", () => [{ kind: "nonsense" }] as never);
        await subscribe(peer);

        await expect(customer.willRunFileOperation(PARAMS)).resolves.toEqual([]);
    });

    it("producer: did goes out as a notification, with or without will listeners", async () => {
        const { customer, peer } = setup();
        const received = vi.fn();
        peer.handleNotification("workspace.didRunFileOperation", received);

        customer.didRunFileOperation({ operation: "delete", files: [{ target: "file:///a" }] });
        await flushMicrotasks();

        expect(received).toHaveBeenCalledExactlyOnceWith({ operation: "delete", files: [{ target: "file:///a" }] });
    });

    it("after the subprocess is gone the subscription is forgotten", async () => {
        const { customer, peer, spawn } = setup();
        await subscribe(peer);
        spawn.dispose();

        await expect(customer.willRunFileOperation(PARAMS)).resolves.toEqual([]);
    });
});
