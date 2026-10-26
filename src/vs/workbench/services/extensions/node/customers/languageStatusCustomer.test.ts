import { describe, expect, it } from "vitest";

import { flushMicrotasks } from "../../../../../../TestUtils/timing.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import type { ILanguageStatusSink } from "../../../../api/common/iLanguageStatusSink.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import type { IExtensionHostContext } from "../../common/extensionHostCustomer.ts";

import { LanguageStatusCustomer } from "./languageStatusCustomer.ts";

const ITEM = {
    handle: 3,
    id: "acme.ruff/server",
    source: "acme.ruff",
    selector: [{ language: "python" }],
    text: "Ruff",
    severity: 0,
    busy: false,
};

function attach(withSink: boolean) {
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a) as unknown as HostRpc;
    const peer = new RpcEndpoint(b);
    const calls: unknown[] = [];
    const sink: ILanguageStatusSink = {
        update: (item) => calls.push(["update", item]),
        remove: (handle) => calls.push(["remove", handle]),
        clear: () => calls.push(["clear"]),
    };
    const customer = new LanguageStatusCustomer(withSink ? sink : undefined);
    const subscription = customer.attach({ rpc: hostRpc } as unknown as IExtensionHostContext);
    return { peer, calls, subscription };
}

describe("LanguageStatusCustomer", () => {
    it("update and dispose from the subprocess reach the sink", async () => {
        const { peer, calls } = attach(true);
        peer.notify("languages.statusItem.update", ITEM);
        peer.notify("languages.statusItem.dispose", { handle: 3 });
        await flushMicrotasks();
        expect(calls).toEqual([
            ["update", ITEM],
            ["remove", 3],
        ]);
    });

    it("garbage is dropped", async () => {
        const { peer, calls } = attach(true);
        peer.notify("languages.statusItem.update", { handle: "x" });
        peer.notify("languages.statusItem.dispose", { handle: 1.5 });
        await flushMicrotasks();
        expect(calls).toEqual([]);
    });

    it("detaching (the subprocess died) clears the sink", () => {
        const { calls, subscription } = attach(true);
        subscription.dispose();
        expect(calls).toEqual([["clear"]]);
    });

    it("without a sink nothing breaks", async () => {
        const { peer, subscription } = attach(false);
        peer.notify("languages.statusItem.update", ITEM);
        peer.notify("languages.statusItem.dispose", { handle: 3 });
        await flushMicrotasks();
        expect(() => {
            subscription.dispose();
        }).not.toThrow();
    });
});
