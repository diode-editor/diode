import { describe, expect, it } from "vitest";

import { flushMicrotasks } from "../../../../../../TestUtils/timing.ts";
import { Emitter } from "../../../../../base/common/event.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import type { IExtensionHostConfigProvider } from "../extensionHost.ts";

import { ConfigurationCustomer } from "./configurationCustomer.ts";

function setup() {
    const changes = new Emitter<readonly string[]>();
    let version = 0;
    const provider = {
        getSnapshot: () => ({ version }),
        getWorkspaceFolders: () => [{ uri: "file:///ws", name: "ws", index: 0 }],
        onDidChange: (cb: (keys: readonly string[]) => void) => changes.event(cb),
    } as unknown as IExtensionHostConfigProvider;
    const customer = new ConfigurationCustomer(provider);
    const [a, b] = createInProcessChannelPair();
    const peer = new RpcEndpoint(b);
    const log: unknown[] = [];
    for (const method of ["workspace.initialize", "workspace.configurationChanged"]) {
        peer.handleNotification(method, (params) => log.push([method, params]));
    }
    const attachTo = () => customer.attach({ rpc: new RpcEndpoint(a), logger: undefined });
    return {
        customer,
        changes,
        log,
        attachTo,
        bump: () => {
            version++;
        },
    };
}

describe("ConfigurationCustomer", () => {
    it("семя workspace.initialize — снимок и папки, только живому спавну", async () => {
        const h = setup();
        h.customer.pushInitialState();
        const attached = h.attachTo();
        h.customer.pushInitialState();
        await flushMicrotasks();
        expect(h.log).toEqual([
            [
                "workspace.initialize",
                { configuration: { version: 0 }, workspaceFolders: [{ uri: "file:///ws", name: "ws", index: 0 }] },
            ],
        ]);

        attached.dispose();
        h.customer.pushInitialState();
        await flushMicrotasks();
        expect(h.log).toHaveLength(1);
    });

    it("смена настроек уходит свежим снимком с ключами; после ухода спавна — никому", async () => {
        const h = setup();
        const attached = h.attachTo();
        h.bump();
        h.changes.fire(["editor.tabSize"]);
        await flushMicrotasks();
        expect(h.log).toEqual([
            ["workspace.configurationChanged", { configuration: { version: 1 }, affectedKeys: ["editor.tabSize"] }],
        ]);

        attached.dispose();
        h.changes.fire(["editor.tabSize"]);
        await flushMicrotasks();
        expect(h.log).toHaveLength(1);
    });
});
