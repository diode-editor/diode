import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { makeStubRpc } from "./testStubRpc.ts";
import { createUriHandlers } from "./uriHandlers.ts";
import { ExtensionOwner } from "./vscodeHostContext.ts";
import { parseWireHandleUri } from "./wireTypes.ts";

function setup(): {
    stub: ReturnType<typeof makeStubRpc>;
    register: (id: string, handler: vscode.UriHandler) => vscode.Disposable;
} {
    const stub = makeStubRpc();
    const owner = new ExtensionOwner();
    const registerUriHandler = createUriHandlers(stub.rpc, owner);
    return { stub, register: (id, handler) => owner.runAs(id, () => registerUriHandler(handler)) };
}

describe("window.registerUriHandler (subprocess)", () => {
    it("registration tells the host the owning extension id", () => {
        const { stub, register } = setup();
        register("Pub.Ext", { handleUri: () => undefined });
        expect(stub.notifies).toEqual([{ method: "window.registerUriHandler", params: { extensionId: "Pub.Ext" } }]);
    });

    it("a second handler from the same extension throws the upstream error; nothing goes to the host", () => {
        const { stub, register } = setup();
        register("pub.ext", { handleUri: () => undefined });
        expect(() => register("PUB.EXT", { handleUri: () => undefined })).toThrow(
            "Protocol handler already registered for extension PUB.EXT",
        );
        expect(stub.notifies).toHaveLength(1);
    });

    it("outside an extension (no owner) throws", () => {
        const stub = makeStubRpc();
        const registerUriHandler = createUriHandlers(stub.rpc, new ExtensionOwner());
        expect(() => registerUriHandler({ handleUri: () => undefined })).toThrow(
            "registerUriHandler: called outside of an extension",
        );
        expect(stub.notifies).toEqual([]);
    });

    it("dispose removes the handler from the host once; a new one can be registered after it", () => {
        const { stub, register } = setup();
        const disposable = register("pub.ext", { handleUri: () => undefined });
        disposable.dispose();
        disposable.dispose();
        expect(stub.notifies.map((n) => n.method)).toEqual([
            "window.registerUriHandler",
            "window.unregisterUriHandler",
        ]);
        expect(stub.notifies[1]?.params).toEqual({ extensionId: "pub.ext" });
        register("pub.ext", { handleUri: () => undefined });
        expect(stub.notifies).toHaveLength(3);
    });

    it("disposing the old registration does not remove the new one", async () => {
        const { stub, register } = setup();
        const first = register("pub.ext", { handleUri: () => undefined });
        first.dispose();
        const handleUri = vi.fn();
        register("pub.ext", { handleUri });
        first.dispose();
        expect(stub.notifies).toHaveLength(3);
        await stub.callRequest("window.handleUri", { extensionId: "pub.ext", uri: "diode://pub.ext/x" });
        expect(handleUri).toHaveBeenCalledOnce();
    });

    it("window.handleUri passes the parsed Uri to the handler and awaits it", async () => {
        const { stub, register } = setup();
        let finished = false;
        const handleUri = vi.fn(async (_uri: vscode.Uri) => {
            await Promise.resolve();
            finished = true;
        });
        register("Pub.Ext", { handleUri });
        const result = await stub.callRequest("window.handleUri", {
            extensionId: "pub.ext",
            uri: "diode://pub.ext/install-plugin?name=a%20b#frag",
        });
        expect(result).toBeNull();
        expect(finished).toBe(true);
        const uri = handleUri.mock.calls[0]?.[0];
        expect(uri.scheme).toBe("diode");
        expect(uri.authority).toBe("pub.ext");
        expect(uri.path).toBe("/install-plugin");
        expect(uri.query).toBe("name=a b");
        expect(uri.fragment).toBe("frag");
    });

    it("a handler failure goes to stderr with the extension id; the host gets a normal response", async () => {
        const { stub, register } = setup();
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const boom = new Error("boom");
        register("pub.ext", {
            handleUri: () => {
                throw boom;
            },
        });
        await expect(
            stub.callRequest("window.handleUri", { extensionId: "pub.ext", uri: "diode://pub.ext/" }),
        ).resolves.toBeNull();
        expect(error).toHaveBeenCalledWith("[pub.ext] uri handler failed", boom);
        error.mockRestore();
    });

    it("a URI for an extension without a handler returns null silently, no failure line", async () => {
        const { stub } = setup();
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        await expect(
            stub.callRequest("window.handleUri", { extensionId: "x.y", uri: "diode://x.y/" }),
        ).resolves.toBeNull();
        expect(error).not.toHaveBeenCalled();
        error.mockRestore();
    });
});

describe("parseWireHandleUri", () => {
    it("string fields pass as is", () => {
        expect(parseWireHandleUri({ extensionId: "a.b", uri: "diode://a.b/" })).toEqual({
            extensionId: "a.b",
            uri: "diode://a.b/",
        });
    });

    it.each([null, 1, {}, { extensionId: "a.b" }, { uri: "diode://a.b/" }, { extensionId: 1, uri: "u" }])(
        "throws without string fields (%j)",
        (raw) => {
            expect(() => parseWireHandleUri(raw)).toThrow("window.handleUri: extensionId and uri must be strings");
        },
    );
});
