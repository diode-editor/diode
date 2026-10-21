import { describe, expect, it } from "vitest";

import { createExtensionsNamespace } from "./extensionsNamespace.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import type { IWireExtensionDescription } from "./wireTypes.ts";

function description(id: string, overrides: Partial<IWireExtensionDescription> = {}): IWireExtensionDescription {
    return {
        id,
        extensionPath: `/ext/${id}`,
        packageJSON: { name: id },
        isActive: false,
        ...overrides,
    };
}

describe("extensionsNamespace", () => {
    it("before the first catalog the set is empty and getExtension returns undefined", () => {
        const { extensions } = createExtensionsNamespace(makeStubRpc().rpc);
        expect(extensions.all).toEqual([]);
        expect(extensions.getExtension("a.b")).toBeUndefined();
    });

    it("the host catalog populates all and getExtension", () => {
        const stub = makeStubRpc();
        const { extensions } = createExtensionsNamespace(stub.rpc);
        stub.fire("extensions.catalog", {
            extensions: [description("pub.one", { isActive: true }), description("pub.two")],
        });
        expect(extensions.all.map((e) => e.id)).toEqual(["pub.one", "pub.two"]);
        const one = extensions.getExtension("pub.one");
        expect(one?.extensionPath).toBe("/ext/pub.one");
        expect(one?.extensionUri.fsPath).toBe("/ext/pub.one");
        expect(one?.packageJSON).toEqual({ name: "pub.one" });
        expect(one?.isActive).toBe(true);
        expect(extensions.getExtension("pub.two")?.isActive).toBe(false);
    });

    it("onDidReceiveCatalog fires with each accepted catalog in full, even without a set change", () => {
        const stub = makeStubRpc();
        const { onDidReceiveCatalog } = createExtensionsNamespace(stub.rpc);
        const received: string[][] = [];
        onDidReceiveCatalog((catalog) => received.push(catalog.map((d) => d.extensionPath)));
        stub.fire("extensions.catalog", { extensions: [description("pub.one")] });
        stub.fire("extensions.catalog", { extensions: [description("pub.one")] });
        stub.fire("extensions.catalog", { what: "wrong" });
        expect(received).toEqual([["/ext/pub.one"], ["/ext/pub.one"]]);
    });

    it("a foreign catalog shape does not touch the known set", () => {
        const stub = makeStubRpc();
        const { extensions } = createExtensionsNamespace(stub.rpc);
        stub.fire("extensions.catalog", { extensions: [description("pub.one")] });
        stub.fire("extensions.catalog", { what: "wrong" });
        expect(extensions.all.map((e) => e.id)).toEqual(["pub.one"]);
    });

    it("`extensions.activated` raises isActive on an already returned object", () => {
        const stub = makeStubRpc();
        const { extensions } = createExtensionsNamespace(stub.rpc);
        stub.fire("extensions.catalog", { extensions: [description("pub.one")] });
        // An extension may hold on to the reference and ask later: it's a live view,
        // not a snapshot taken at getExtension time.
        const held = extensions.getExtension("pub.one");
        expect(held?.isActive).toBe(false);
        stub.fire("extensions.activated", { id: "pub.one" });
        expect(held?.isActive).toBe(true);
    });

    it("a garbage `extensions.activated` is ignored", () => {
        const stub = makeStubRpc();
        const { extensions } = createExtensionsNamespace(stub.rpc);
        stub.fire("extensions.catalog", { extensions: [description("pub.one")] });
        stub.fire("extensions.activated", { id: 42 });
        expect(extensions.getExtension("pub.one")?.isActive).toBe(false);
    });

    it("a catalog arriving AFTER activated does not clear the raised flag", () => {
        // Message order from the host isn't guaranteed; an older catalog snapshot
        // must not lose the active state.
        const stub = makeStubRpc();
        const { extensions } = createExtensionsNamespace(stub.rpc);
        stub.fire("extensions.catalog", { extensions: [description("pub.one")] });
        stub.fire("extensions.activated", { id: "pub.one" });
        stub.fire("extensions.catalog", { extensions: [description("pub.one"), description("pub.two")] });
        expect(extensions.getExtension("pub.one")?.isActive).toBe(true);
    });

    it("an extension gone from the catalog is no longer active", () => {
        const stub = makeStubRpc();
        const { extensions } = createExtensionsNamespace(stub.rpc);
        stub.fire("extensions.catalog", { extensions: [description("pub.one", { isActive: true })] });
        stub.fire("extensions.catalog", { extensions: [description("pub.two")] });
        expect(extensions.getExtension("pub.one")).toBeUndefined();
        // Came back under the same id, but inactive: the flag didn't resurface.
        stub.fire("extensions.catalog", { extensions: [description("pub.one")] });
        expect(extensions.getExtension("pub.one")?.isActive).toBe(false);
    });

    it("onDidChange is about the set: fires on add and remove, silent on activation", () => {
        const stub = makeStubRpc();
        const { extensions } = createExtensionsNamespace(stub.rpc);
        let fired = 0;
        extensions.onDidChange(() => {
            fired += 1;
        });
        stub.fire("extensions.catalog", { extensions: [description("pub.one")] });
        expect(fired).toBe(1);
        stub.fire("extensions.catalog", { extensions: [description("pub.one", { isActive: true })] });
        expect(fired).toBe(1);
        stub.fire("extensions.activated", { id: "pub.one" });
        expect(fired).toBe(1);
        stub.fire("extensions.catalog", { extensions: [description("pub.one"), description("pub.two")] });
        expect(fired).toBe(2);
        stub.fire("extensions.catalog", { extensions: [description("pub.two")] });
        expect(fired).toBe(3);
    });

    it("reordering the same extensions is also a set change", () => {
        const stub = makeStubRpc();
        const { extensions } = createExtensionsNamespace(stub.rpc);
        let fired = 0;
        extensions.onDidChange(() => {
            fired += 1;
        });
        stub.fire("extensions.catalog", { extensions: [description("pub.one"), description("pub.two")] });
        expect(fired).toBe(1);
        stub.fire("extensions.catalog", { extensions: [description("pub.two"), description("pub.one")] });
        expect(fired).toBe(2);
    });

    it("replacing ONE extension of two is also a set change", () => {
        // Only the second id differs: the comparison is "any one differs", not "all".
        const stub = makeStubRpc();
        const { extensions } = createExtensionsNamespace(stub.rpc);
        let fired = 0;
        extensions.onDidChange(() => {
            fired += 1;
        });
        stub.fire("extensions.catalog", { extensions: [description("pub.one"), description("pub.two")] });
        expect(fired).toBe(1);
        stub.fire("extensions.catalog", { extensions: [description("pub.one"), description("pub.three")] });
        expect(fired).toBe(2);
    });

    it("exports are read from the subprocess shared map, not from the wire", () => {
        const stub = makeStubRpc();
        const { extensions, exportsById } = createExtensionsNamespace(stub.rpc);
        stub.fire("extensions.catalog", { extensions: [description("pub.one")] });
        expect(extensions.getExtension("pub.one")?.exports).toBeUndefined();
        exportsById.set("pub.one", { api: 1 });
        expect(extensions.getExtension("pub.one")?.exports).toEqual({ api: 1 });
    });

    it("activate() returns exports for an active one and rejects with an explanation for an inactive one", async () => {
        const stub = makeStubRpc();
        const { extensions, exportsById } = createExtensionsNamespace(stub.rpc);
        stub.fire("extensions.catalog", { extensions: [description("pub.one"), description("pub.two")] });
        exportsById.set("pub.one", { api: 1 });
        stub.fire("extensions.activated", { id: "pub.one" });

        const active = extensions.getExtension("pub.one")!;
        await expect(active.activate()).resolves.toEqual({ api: 1 });

        // The whole message: without "activation is up to the host" an extension author would go fix their own code.
        const sleeping = extensions.getExtension("pub.two")!;
        await expect(sleeping.activate()).rejects.toThrow(
            "extension.activate() is not implemented in Diode: activation is driven by the host. " +
                "Extensions that are already active return their exports.",
        );
    });

    it("entry identity is stable within a set and refreshed with a new catalog", () => {
        // Comparison by reference does occur in extensions (we got burned on `activeTextEditor`).
        const stub = makeStubRpc();
        const { extensions } = createExtensionsNamespace(stub.rpc);
        stub.fire("extensions.catalog", { extensions: [description("pub.one")] });
        const first = extensions.getExtension("pub.one");
        expect(extensions.getExtension("pub.one")).toBe(first);
        expect(extensions.all[0]).toBe(first);
        expect(extensions.all).toBe(extensions.all);

        stub.fire("extensions.catalog", { extensions: [description("pub.one"), description("pub.two")] });
        expect(extensions.getExtension("pub.one")).not.toBe(first);
    });

    it("extensionKind is UI for all: Diode has no remote extension host", () => {
        const stub = makeStubRpc();
        const { extensions } = createExtensionsNamespace(stub.rpc);
        stub.fire("extensions.catalog", { extensions: [description("pub.one")] });
        expect(extensions.all.map((e) => e.extensionKind)).toEqual([1]);
    });
});
