import { describe, expect, it } from "vitest";

import { createExtensionSecretsFactory } from "./extensionSecrets.ts";
import { makeStubRpc } from "./testStubRpc.ts";

describe("extensionSecrets", () => {
    it("каждый вызов уходит запросом к хосту со СВОИМ id расширения", async () => {
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

    it("get разбирает ответ хоста: строка — значение, всё прочее — «нет секрета»", async () => {
        const stub = makeStubRpc();
        const secrets = createExtensionSecretsFactory(stub.rpc).create("pub.one");
        stub.responder = () => ({ value: "s3cr3t" });
        await expect(secrets.get("token")).resolves.toBe("s3cr3t");
        stub.responder = () => ({ value: null });
        await expect(secrets.get("token")).resolves.toBeUndefined();
    });

    it("keys отдаёт список хоста, а на мусор — пустой", async () => {
        const stub = makeStubRpc();
        const secrets = createExtensionSecretsFactory(stub.rpc).create("pub.one");
        stub.responder = () => ({ keys: ["token", 42, "refresh"] });
        await expect(secrets.keys()).resolves.toEqual(["token", "refresh"]);
        stub.responder = () => null;
        await expect(secrets.keys()).resolves.toEqual([]);
    });

    it("onDidChange приходит только своему расширению", () => {
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

    it("событие про расширение, которое секретов не трогало, никого не роняет", () => {
        const stub = makeStubRpc();
        const factory = createExtensionSecretsFactory(stub.rpc);
        const seen: string[] = [];
        factory.create("pub.one").onDidChange((e) => seen.push(e.key));
        expect(() => {
            stub.fire("secrets.changed", { extensionId: "pub.unknown", key: "token" });
        }).not.toThrow();
        expect(seen).toEqual([]);
    });

    it("чужая форма `secrets.changed` игнорируется", () => {
        const stub = makeStubRpc();
        const factory = createExtensionSecretsFactory(stub.rpc);
        const seen: string[] = [];
        factory.create("pub.one").onDidChange((e) => seen.push(e.key));
        stub.fire("secrets.changed", { extensionId: "pub.one" });
        expect(seen).toEqual([]);
    });

    it("повторный create для того же расширения делит один эмиттер", () => {
        // Иначе `context.secrets` пересозданного контекста слушал бы в пустоту.
        const stub = makeStubRpc();
        const factory = createExtensionSecretsFactory(stub.rpc);
        const seen: string[] = [];
        factory.create("pub.one").onDidChange((e) => seen.push(`first:${e.key}`));
        factory.create("pub.one").onDidChange((e) => seen.push(`second:${e.key}`));
        stub.fire("secrets.changed", { extensionId: "pub.one", key: "token" });
        expect(seen).toEqual(["first:token", "second:token"]);
    });
});
