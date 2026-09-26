import { describe, expect, it } from "vitest";

import { Uri } from "../../../base/common/uri.ts";

import { createEnvNamespace } from "./envNamespace.ts";
import { makeStubRpc } from "./testStubRpc.ts";

function makeEnv() {
    const stub = makeStubRpc();
    return { stub, env: createEnvNamespace(stub.rpc) };
}

describe("createEnvNamespace", () => {
    it("константы, которые читает vscode-languageclient", () => {
        const { env } = makeEnv();
        expect(env.appName).toBe("Diode");
        expect(env.appHost).toBe("desktop");
        expect(env.language).toBe("en");
        expect(env.uriScheme).toBe("diode");
    });

    it("clipboard.readText спрашивает хоста", async () => {
        const { stub, env } = makeEnv();
        stub.responder = (method) => (method === "env.clipboard.readText" ? { text: "из буфера" } : undefined);
        await expect(env.clipboard.readText()).resolves.toBe("из буфера");
        expect(stub.requests).toEqual([{ method: "env.clipboard.readText", params: {} }]);
    });

    it("clipboard.readText на молчание хоста отдаёт пустую строку", async () => {
        const { env } = makeEnv();
        await expect(env.clipboard.readText()).resolves.toBe("");
    });

    it("clipboard.writeText уходит ЗАПРОСОМ: расширение вправе ждать записи", async () => {
        const { stub, env } = makeEnv();
        await env.clipboard.writeText("скопировано");
        expect(stub.requests).toEqual([{ method: "env.clipboard.writeText", params: { text: "скопировано" } }]);
        expect(stub.notifies).toEqual([]);
    });

    it("openExternal шлёт адрес строкой и резолвится ответом хоста", async () => {
        const { stub, env } = makeEnv();
        stub.responder = () => ({ opened: true });
        await expect(env.openExternal(Uri.parse("https://example.com/auth") as never)).resolves.toBe(true);
        expect(stub.requests).toEqual([{ method: "env.openExternal", params: { target: "https://example.com/auth" } }]);
    });

    it("query не percent-кодируется: `?token=demo` обязан дойти до человека как есть", async () => {
        const { stub, env } = makeEnv();
        stub.responder = () => ({ opened: true });
        await env.openExternal(Uri.parse("https://example.com/activate?token=demo&next=/a b") as never);
        expect((stub.requests[0]?.params as { target: string }).target).toBe(
            "https://example.com/activate?token=demo&next=/a b",
        );
    });

    it("openExternal: отказ хоста доезжает как false", async () => {
        const { stub, env } = makeEnv();
        stub.responder = () => ({ opened: false });
        await expect(env.openExternal(Uri.parse("https://example.com") as never)).resolves.toBe(false);
    });
});
