import { describe, expect, it } from "vitest";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";

describe("vscode.env — host constants (env.initialize)", () => {
    it("machineId and shell come from the host seed", () => {
        const stub = makeStubRpc();
        const { env } = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk()).namespace;
        stub.fire("env.initialize", { machineId: "a1b2", shell: "/usr/bin/fish" });
        expect(env.machineId).toBe("a1b2");
        expect(env.shell).toBe("/usr/bin/fish");
    });

    it("before the seed they are empty strings, not undefined (both members are string by contract)", () => {
        const { env } = buildVscodeNamespace(makeStubRpc().rpc, createNodeExtHostDisk()).namespace;
        expect(env.machineId).toBe("");
        expect(env.shell).toBe("");
    });

    it("garbage in the seed gives empty strings", () => {
        const stub = makeStubRpc();
        const { env } = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk()).namespace;
        stub.fire("env.initialize", { machineId: 42, shell: null });
        expect(env.machineId).toBe("");
        expect(env.shell).toBe("");
        stub.fire("env.initialize", "not-an-object");
        expect(env.machineId).toBe("");
    });

    it("onDidChangeShell is a valid event; there are no profiles and the seed does not fire it", () => {
        const stub = makeStubRpc();
        const { env } = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk()).namespace;
        const fired: string[] = [];
        const sub = env.onDidChangeShell((shell) => fired.push(shell));
        stub.fire("env.initialize", { machineId: "m", shell: "/bin/zsh" });
        expect(fired).toEqual([]);
        sub.dispose();
    });
});
