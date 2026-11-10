import { describe, expect, it } from "vitest";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { ApiTrace } from "./apiTrace.ts";
import { createExtensionApi } from "./extensionApiFactory.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";

// Test files are ES modules, so strict mode, as an extension built with upstream's tsconfig.

function build(): ReturnType<typeof buildVscodeNamespace> & { stub: ReturnType<typeof makeStubRpc> } {
    const stub = makeStubRpc();
    return { ...buildVscodeNamespace(stub.rpc, createNodeExtHostDisk()), stub };
}

const journal = (): ApiTrace =>
    new ApiTrace({ write: () => undefined, schedule: () => undefined, onError: () => undefined });

describe.each([
    ["without", undefined],
    ["with", "journal"],
])("frozen env stays live, %s the call journal", (_label, withTrace) => {
    it("[api:env.machineId][api:env.shell][api:env.appRoot] the host seed arriving after activation is visible", () => {
        const { namespace, owner, stub } = build();
        const api = createExtensionApi(namespace, owner, "pub.a", withTrace ? journal() : undefined);
        expect(api.env.shell).toBe("");
        stub.fire("env.initialize", { machineId: "a1b2", shell: "/usr/bin/fish", appRoot: "/opt/diode" });
        expect(api.env.machineId).toBe("a1b2");
        expect(api.env.shell).toBe("/usr/bin/fish");
        expect(api.env.appRoot).toBe("/opt/diode");
    });

    it("[api:env] the frozen env keeps every member of the plain namespace", () => {
        const { namespace, owner } = build();
        const api = createExtensionApi(namespace, owner, "pub.a", withTrace ? journal() : undefined);
        expect(Object.keys(api.env).sort()).toEqual(Object.keys(namespace.env).sort());
        expect(typeof api.env.onDidChangeShell).toBe("function");
        expect(typeof api.env.onDidChangeTelemetryEnabled).toBe("function");
        expect(api.env.isTelemetryEnabled).toBe(false);
    });

    it("[api:workspace.workspaceFolders] a live workspace getter stays live", () => {
        const { namespace, owner, stub } = build();
        const api = createExtensionApi(namespace, owner, "pub.a", withTrace ? journal() : undefined);
        expect(api.workspace.workspaceFolders).toBeUndefined();
        stub.fire("workspace.initialize", {
            configuration: { defaults: {}, user: {} },
            workspaceFolders: [{ uri: "/repo", name: "repo", index: 0 }],
        });
        expect(api.workspace.workspaceFolders?.[0]?.name).toBe("repo");
    });

    it("[api:workspace.getConfiguration] frozen configuration object: values from get may be changed in strict code, a new snapshot follows a change", () => {
        const { namespace, owner, stub } = build();
        const api = createExtensionApi(namespace, owner, "pub.a", withTrace ? journal() : undefined);
        stub.fire("workspace.initialize", {
            configuration: {
                defaults: {},
                user: { files: { exclude: { "**/.git": true }, list: ["a"] }, editor: { tabSize: 2 } },
            },
            workspaceFolders: [],
        });
        const files = api.workspace.getConfiguration("files");
        expect(Object.isFrozen(files)).toBe(true);
        // Upstream: get returns a clone-on-write view; a strict-mode extension may change it.
        const exclude = files.get<Record<string, boolean>>("exclude")!;
        expect(() => {
            exclude["**/node_modules"] = true;
        }).not.toThrow();
        const list = files.get<string[]>("list")!;
        expect(() => list.push("b")).not.toThrow();

        const root = api.workspace.getConfiguration();
        expect(Object.isFrozen(root)).toBe(true);
        expect(root.get("editor.tabSize")).toBe(2);
        expect(typeof root.get).toBe("function");

        stub.fire("workspace.configurationChanged", {
            configuration: { defaults: {}, user: { editor: { tabSize: 8 } } },
            affectedKeys: ["editor.tabSize"],
        });
        expect(api.workspace.getConfiguration("editor").get("tabSize")).toBe(8);
        expect((api.workspace.getConfiguration("editor") as unknown as { tabSize: number }).tabSize).toBe(8);
    });

    it("[api:workspace.getConfiguration] a key named like a method does not replace the method", () => {
        const { namespace, owner, stub } = build();
        const api = createExtensionApi(namespace, owner, "pub.a", withTrace ? journal() : undefined);
        stub.fire("workspace.initialize", {
            configuration: { defaults: { farboo: { get: "get-prop", update: 1, has: true, inspect: "x" } }, user: {} },
            workspaceFolders: [],
        });
        const config = api.workspace.getConfiguration("farboo");
        expect(typeof config.get).toBe("function");
        expect(typeof config.update).toBe("function");
        expect(typeof config.has).toBe("function");
        expect(typeof config.inspect).toBe("function");
        expect(config.get("get")).toBe("get-prop");
        expect(config.get("update")).toBe(1);
    });
});
