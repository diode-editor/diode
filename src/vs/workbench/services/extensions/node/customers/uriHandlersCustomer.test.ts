import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../../TestUtils/timing.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import { parseWireUriHandlerRegistration } from "../hostWireParsers.ts";

import { UriHandlersCustomer } from "./uriHandlersCustomer.ts";

function setup() {
    const customer = new UriHandlersCustomer();
    const [a, b] = createInProcessChannelPair();
    const peer = new RpcEndpoint(b);
    const spawn = customer.attach({ rpc: new RpcEndpoint(a), logger: undefined });
    return { customer, peer, spawn };
}

describe("UriHandlersCustomer", () => {
    it("subprocess registration — the handler exists (case-insensitive) and the event carries the id as sent", async () => {
        const { customer, peer } = setup();
        const registered = vi.fn();
        customer.onDidRegister(registered);
        expect(customer.has("pub.ext")).toBe(false);
        peer.notify("window.registerUriHandler", { extensionId: "Pub.Ext" });
        await flushMicrotasks();
        expect(customer.has("pub.ext")).toBe(true);
        expect(customer.has("PUB.EXT")).toBe(true);
        expect(customer.has("other.ext")).toBe(false);
        expect(registered).toHaveBeenCalledExactlyOnceWith("Pub.Ext");
    });

    it("a structurally foreign registration is ignored", async () => {
        const { customer, peer } = setup();
        const registered = vi.fn();
        customer.onDidRegister(registered);
        peer.notify("window.registerUriHandler", { extensionId: "" });
        peer.notify("window.registerUriHandler", null);
        await flushMicrotasks();
        expect(registered).not.toHaveBeenCalled();
    });

    it("unregister removes the handler", async () => {
        const { customer, peer } = setup();
        peer.notify("window.registerUriHandler", { extensionId: "pub.ext" });
        peer.notify("window.unregisterUriHandler", { extensionId: "PUB.ext" });
        await flushMicrotasks();
        expect(customer.has("pub.ext")).toBe(false);
    });

    it("a structurally foreign unregistration is ignored: the handler stays", async () => {
        const { customer, peer } = setup();
        peer.notify("window.registerUriHandler", { extensionId: "pub.ext" });
        peer.notify("window.unregisterUriHandler", { extensionId: "" });
        peer.notify("window.unregisterUriHandler", null);
        await flushMicrotasks();
        expect(customer.has("pub.ext")).toBe(true);
    });

    it("handle sends the URI as a window.handleUri request and awaits the reply", async () => {
        const { customer, peer } = setup();
        let release!: () => void;
        const handled = vi.fn(
            () =>
                new Promise<null>((resolve) => {
                    release = () => {
                        resolve(null);
                    };
                }),
        );
        peer.handleRequest("window.handleUri", handled);
        peer.notify("window.registerUriHandler", { extensionId: "pub.ext" });
        await flushMicrotasks();
        let done = false;
        const pending = customer.handle("Pub.Ext", "diode://pub.ext/a").then(() => {
            done = true;
        });
        await flushMicrotasks();
        expect(handled).toHaveBeenCalledWith({ extensionId: "Pub.Ext", uri: "diode://pub.ext/a" }, expect.anything());
        expect(done).toBe(false);
        release();
        await pending;
        expect(done).toBe(true);
    });

    it("handle without a handler — rejected", async () => {
        const { customer } = setup();
        await expect(customer.handle("pub.ext", "diode://pub.ext/")).rejects.toThrow(
            'no uri handler for extension "pub.ext"',
        );
    });

    it("spawn death forgets handlers; there are none before the first spawn", async () => {
        const fresh = new UriHandlersCustomer();
        expect(fresh.has("pub.ext")).toBe(false);
        await expect(fresh.handle("pub.ext", "diode://pub.ext/")).rejects.toThrow(
            'no uri handler for extension "pub.ext"',
        );
        const { customer, peer, spawn } = setup();
        peer.notify("window.registerUriHandler", { extensionId: "pub.ext" });
        await flushMicrotasks();
        spawn.dispose();
        expect(customer.has("pub.ext")).toBe(false);
    });
});

describe("parseWireUriHandlerRegistration", () => {
    it("a non-empty string is an id, otherwise null", () => {
        expect(parseWireUriHandlerRegistration({ extensionId: "a.b" })).toBe("a.b");
        expect(parseWireUriHandlerRegistration({ extensionId: "" })).toBeNull();
        expect(parseWireUriHandlerRegistration({ extensionId: 1 })).toBeNull();
        expect(parseWireUriHandlerRegistration({})).toBeNull();
        expect(parseWireUriHandlerRegistration(null)).toBeNull();
    });
});
