import { describe, expect, it } from "vitest";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";

describe("vscode.env — константы хоста (env.initialize)", () => {
    it("machineId и shell — из семени хоста", () => {
        const stub = makeStubRpc();
        const { env } = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk()).namespace;
        stub.fire("env.initialize", { machineId: "a1b2", shell: "/usr/bin/fish" });
        expect(env.machineId).toBe("a1b2");
        expect(env.shell).toBe("/usr/bin/fish");
    });

    it("до семени — пустые строки, а не undefined (оба члена — string по контракту)", () => {
        const { env } = buildVscodeNamespace(makeStubRpc().rpc, createNodeExtHostDisk()).namespace;
        expect(env.machineId).toBe("");
        expect(env.shell).toBe("");
    });

    it("мусор в семени — пустые строки", () => {
        const stub = makeStubRpc();
        const { env } = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk()).namespace;
        stub.fire("env.initialize", { machineId: 42, shell: null });
        expect(env.machineId).toBe("");
        expect(env.shell).toBe("");
        stub.fire("env.initialize", "not-an-object");
        expect(env.machineId).toBe("");
    });

    it("onDidChangeShell — валидное событие; профилей нет, и семя его не стреляет", () => {
        const stub = makeStubRpc();
        const { env } = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk()).namespace;
        const fired: string[] = [];
        const sub = env.onDidChangeShell((shell) => fired.push(shell));
        stub.fire("env.initialize", { machineId: "m", shell: "/bin/zsh" });
        expect(fired).toEqual([]);
        sub.dispose();
    });
});
