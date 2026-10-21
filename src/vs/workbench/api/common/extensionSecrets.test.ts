import { describe, expect, it } from "vitest";

import { createExtensionSecretsFactory } from "./extensionSecrets.ts";
import { makeStubRpc } from "./testStubRpc.ts";

describe("extensionSecrets", () => {
    it("each call goes to the host as a request with ITS OWN extension id", async () => {
        const stub = makeStubRpc();
        const secrets = createExtensionSecretsFactory(stub.rpc).create("pub.one");
        await secrets.get("token");
        await secrets.store("token", "s3cr3t");
        await secrets.delete("token");
        await secrets.keys();
        expect(stub.requests).toEqual([
            { method: "secrets.get", params: { extensionId: "pub.one", key: "token" } },
            { method: "secrets.store", params: { extensionId: "pub.one", key: "token", value: "s3cr3t" } },
            { method: "secrets.delete", params: { extensionId: "pub.one", key: "token" } },
            { method: "secrets.keys", params: { extensionId: "pub.one" } },
        ]);
    });

    it("get parses the host answer: a string is the value, anything else means no secret", async () => {
        const stub = makeStubRpc();
        const secrets = createExtensionSecretsFactory(stub.rpc).create("pub.one");
        stub.responder = () => ({ value: "s3cr3t" });
        await expect(secrets.get("token")).resolves.toBe("s3cr3t");
        stub.responder = () => ({ value: null });
        await expect(secrets.get("token")).resolves.toBeUndefined();
    });

    it("keys returns the host list, and an empty one for garbage", async () => {
        const stub = makeStubRpc();
        const secrets = createExtensionSecretsFactory(stub.rpc).create("pub.one");
        stub.responder = () => ({ keys: ["token", 42, "refresh"] });
        await expect(secrets.keys()).resolves.toEqual(["token", "refresh"]);
        stub.responder = () => null;
        await expect(secrets.keys()).resolves.toEqual([]);
    });

    it("onDidChange reaches only its own extension", () => {
        const stub = makeStubRpc();
        const factory = createExtensionSecretsFactory(stub.rpc);
        const one: string[] = [];
        const two: string[] = [];
        factory.create("pub.one").onDidChange((e) => one.push(e.key));
        factory.create("pub.two").onDidChange((e) => two.push(e.key));

        stub.fire("secrets.changed", { extensionId: "pub.one", key: "token" });
        stub.fire("secrets.changed", { extensionId: "pub.two", key: "other" });
        expect(one).toEqual(["token"]);
        expect(two).toEqual(["other"]);
    });

    it("an event for an extension that never touched secrets breaks nothing", () => {
        const stub = makeStubRpc();
        const factory = createExtensionSecretsFactory(stub.rpc);
        const seen: string[] = [];
        factory.create("pub.one").onDidChange((e) => seen.push(e.key));
        expect(() => {
            stub.fire("secrets.changed", { extensionId: "pub.unknown", key: "token" });
        }).not.toThrow();
        expect(seen).toEqual([]);
    });

    it("a foreign `secrets.changed` shape is ignored", () => {
        const stub = makeStubRpc();
        const factory = createExtensionSecretsFactory(stub.rpc);
        const seen: string[] = [];
        factory.create("pub.one").onDidChange((e) => seen.push(e.key));
        stub.fire("secrets.changed", { extensionId: "pub.one" });
        expect(seen).toEqual([]);
    });

    it("a repeated create for the same extension shares one emitter", () => {
        // Otherwise `context.secrets` of a recreated context would listen to nothing.
        const stub = makeStubRpc();
        const factory = createExtensionSecretsFactory(stub.rpc);
        const seen: string[] = [];
        factory.create("pub.one").onDidChange((e) => seen.push(`first:${e.key}`));
        factory.create("pub.one").onDidChange((e) => seen.push(`second:${e.key}`));
        stub.fire("secrets.changed", { extensionId: "pub.one", key: "token" });
        expect(seen).toEqual(["first:token", "second:token"]);
    });
});
