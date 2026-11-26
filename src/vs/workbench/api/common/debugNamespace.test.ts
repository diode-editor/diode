import { describe, expect, it, vi } from "vitest";

import { CancellationTokenSource } from "../../../base/common/cancellation.ts";
import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";

function makeVscode() {
    const stub = makeStubRpc();
    const { namespace } = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk());
    return { stub, vscode: namespace };
}

function warnings(stub: ReturnType<typeof makeStubRpc>): string[] {
    return stub.notifies
        .filter((n) => n.method === "output.append")
        .map((n) => n.params as { value: string; level: string; channel: string; label: string })
        .map((p) => `${p.channel}/${p.label}/${p.level}: ${p.value}`);
}

const session = { id: "s 1/2" } as never;

const FOLDER = "file:///ws";
const CONFIG = { type: "lldb", name: "Launch", request: "launch", program: "${workspaceFolder}/a.out" };

function withFolder() {
    const made = makeVscode();
    made.stub.fire("workspace.initialize", { workspaceFolders: [{ uri: FOLDER, name: "ws", index: 0 }] });
    return made;
}

function registrations(stub: ReturnType<typeof makeStubRpc>): unknown[] {
    return stub.notifies.filter((n) => n.method.startsWith("debug.")).map((n) => ({ [n.method]: n.params }));
}

describe("vscode.debug — what the core has: configuration providers, startDebugging, stopDebugging", () => {
    it("before the core says anything: no session, breakpoints or stack frame", () => {
        const { vscode } = makeVscode();
        expect(vscode.debug.activeDebugSession).toBeUndefined();
        expect(vscode.debug.activeStackItem).toBeUndefined();
        expect(vscode.debug.breakpoints).toEqual([]);
    });

    describe("registerDebugConfigurationProvider", () => {
        it("[api:debug.registerDebugConfigurationProvider] tells the core the type, the trigger kind and which methods there are; dispose unregisters once", () => {
            const { stub, vscode } = makeVscode();
            const initial = vscode.debug.registerDebugConfigurationProvider("lldb", {
                resolveDebugConfiguration: (_folder, config) => config,
            });
            const dynamic = vscode.debug.registerDebugConfigurationProvider(
                "lldb",
                { provideDebugConfigurations: () => [], resolveDebugConfigurationWithSubstitutedVariables: () => null },
                vscode.DebugConfigurationProviderTriggerKind.Dynamic,
            );
            initial.dispose();
            initial.dispose();
            dynamic.dispose();

            expect(registrations(stub)).toEqual([
                {
                    "debug.registerConfigurationProvider": {
                        handle: 0,
                        type: "lldb",
                        triggerKind: 1,
                        hasProvide: false,
                        hasResolve: true,
                        hasResolveWithSubstitutedVariables: false,
                        extensionId: "",
                    },
                },
                {
                    "debug.registerConfigurationProvider": {
                        handle: 1,
                        type: "lldb",
                        triggerKind: 2,
                        hasProvide: true,
                        hasResolve: false,
                        hasResolveWithSubstitutedVariables: true,
                        extensionId: "",
                    },
                },
                { "debug.unregisterConfigurationProvider": { handle: 0 } },
                { "debug.unregisterConfigurationProvider": { handle: 1 } },
            ]);
        });

        it("no provider registers nothing (upstream)", () => {
            const { stub, vscode } = makeVscode();
            vscode.debug.registerDebugConfigurationProvider("lldb", undefined as never).dispose();
            expect(registrations(stub)).toEqual([]);
        });

        it("a provider says nothing to the user: it is asked by the core", () => {
            const { stub, vscode } = makeVscode();
            vscode.debug.registerDebugConfigurationProvider("go", {});
            expect(warnings(stub)).toEqual([]);
        });

        it("[api:debug.registerDebugConfigurationProvider] provideDebugConfigurations gets the workspace folder of the uri and a token", async () => {
            const { stub, vscode } = withFolder();
            const provide = vi.fn((folder: unknown, token?: { isCancellationRequested: boolean }) => [
                {
                    ...CONFIG,
                    folder: (folder as { name?: string } | undefined)?.name,
                    cancelled: token?.isCancellationRequested,
                },
            ]);
            vscode.debug.registerDebugConfigurationProvider("lldb", { provideDebugConfigurations: provide });

            await expect(
                stub.callRequest("debug.provideConfigurations", { handle: 0, folder: FOLDER }),
            ).resolves.toEqual([{ ...CONFIG, folder: "ws", cancelled: false }]);
            // Not a folder of the workspace, or none: `undefined`.
            await stub.callRequest("debug.provideConfigurations", { handle: 0, folder: "file:///elsewhere" });
            await stub.callRequest("debug.provideConfigurations", { handle: 0 });
            expect(provide.mock.calls.map(([folder]) => folder)).toEqual([
                vscode.workspace.workspaceFolders?.[0],
                undefined,
                undefined,
            ]);
        });

        it("without workspace folders a folder uri is no folder", async () => {
            const { stub, vscode } = makeVscode();
            const provide = vi.fn(() => [CONFIG]);
            vscode.debug.registerDebugConfigurationProvider("lldb", { provideDebugConfigurations: provide });

            await stub.callRequest("debug.provideConfigurations", { handle: 0, folder: FOLDER });

            expect(provide).toHaveBeenCalledWith(undefined, expect.anything());
        });

        it("a cancelled core request cancels the provider's token", async () => {
            const { stub, vscode } = makeVscode();
            const source = new CancellationTokenSource();
            vscode.debug.registerDebugConfigurationProvider("lldb", {
                resolveDebugConfiguration: (_folder, config, token) =>
                    new Promise((resolve) => {
                        token?.onCancellationRequested(() => {
                            resolve({ ...config, cancelled: true });
                        });
                    }),
            });

            const answer = stub.callRequest("debug.resolveConfiguration", { handle: 0, config: CONFIG }, source.token);
            source.cancel();

            await expect(answer).resolves.toEqual({ config: { ...CONFIG, cancelled: true } });
        });

        it("[api:debug.registerDebugConfigurationProvider] resolve answers keep undefined (no config) apart from null", async () => {
            const { stub, vscode } = makeVscode();
            const answers: unknown[] = [{ ...CONFIG, program: "/a.out" }, undefined, null];
            vscode.debug.registerDebugConfigurationProvider("lldb", {
                resolveDebugConfiguration: () => answers.shift() as never,
                resolveDebugConfigurationWithSubstitutedVariables: (_folder, config) => ({ ...config, port: 1 }),
            });

            const resolve = () => stub.callRequest("debug.resolveConfiguration", { handle: 0, config: CONFIG });
            await expect(resolve()).resolves.toEqual({ config: { ...CONFIG, program: "/a.out" } });
            await expect(resolve()).resolves.toEqual({});
            await expect(resolve()).resolves.toEqual({ config: null });
            await expect(
                stub.callRequest("debug.resolveConfigurationWithSubstitutedVariables", { handle: 0, config: CONFIG }),
            ).resolves.toEqual({ config: { ...CONFIG, port: 1 } });
        });

        it("a gone provider, a missing method and no configurations are upstream's errors", async () => {
            const { stub, vscode } = makeVscode();
            vscode.debug.registerDebugConfigurationProvider("lldb", { provideDebugConfigurations: () => undefined });
            vscode.debug.registerDebugConfigurationProvider("lldb", {}).dispose();

            await expect(stub.callRequest("debug.provideConfigurations", { handle: 0 })).rejects.toThrow(
                "nothing returned from DebugConfigurationProvider.provideDebugConfigurations",
            );
            await expect(stub.callRequest("debug.resolveConfiguration", { handle: 1, config: CONFIG })).rejects.toThrow(
                "no DebugConfigurationProvider found",
            );
            await expect(stub.callRequest("debug.resolveConfiguration", { handle: 0, config: CONFIG })).rejects.toThrow(
                "DebugConfigurationProvider has no method resolveDebugConfiguration",
            );
            await expect(
                stub.callRequest("debug.resolveConfigurationWithSubstitutedVariables", { handle: 0, config: CONFIG }),
            ).rejects.toThrow(
                "DebugConfigurationProvider has no method resolveDebugConfigurationWithSubstitutedVariables",
            );
            vscode.debug.registerDebugConfigurationProvider("lldb", { resolveDebugConfiguration: () => undefined });
            await expect(stub.callRequest("debug.provideConfigurations", { handle: 2 })).rejects.toThrow(
                "DebugConfigurationProvider has no method provideDebugConfigurations",
            );
        });

        it("the provider is called as a method: `this` is the provider", async () => {
            const { stub, vscode } = makeVscode();
            const provider = {
                suffix: "!",
                provideDebugConfigurations(this: { suffix: string }) {
                    return [{ ...CONFIG, name: `a${this.suffix}` }];
                },
                resolveDebugConfiguration(this: { suffix: string }, _folder: unknown, config: typeof CONFIG) {
                    return { ...config, name: `b${this.suffix}` };
                },
                resolveDebugConfigurationWithSubstitutedVariables(
                    this: { suffix: string },
                    _folder: unknown,
                    config: typeof CONFIG,
                ) {
                    return { ...config, name: `c${this.suffix}` };
                },
            };
            vscode.debug.registerDebugConfigurationProvider("lldb", provider as never);

            expect(await stub.callRequest("debug.provideConfigurations", { handle: 0 })).toEqual([
                { ...CONFIG, name: "a!" },
            ]);
            expect(await stub.callRequest("debug.resolveConfiguration", { handle: 0, config: CONFIG })).toEqual({
                config: { ...CONFIG, name: "b!" },
            });
            expect(
                await stub.callRequest("debug.resolveConfigurationWithSubstitutedVariables", {
                    handle: 0,
                    config: CONFIG,
                }),
            ).toEqual({ config: { ...CONFIG, name: "c!" } });
        });
    });

    describe("startDebugging and stopDebugging go to the core", () => {
        it("[api:debug.startDebugging] the folder's uri, the name or configuration and the options; the core's answer", async () => {
            const { stub, vscode } = withFolder();
            stub.responder = () => true;
            const folder = vscode.workspace.workspaceFolders?.[0];

            await expect(vscode.debug.startDebugging(folder, "Launch")).resolves.toBe(true);
            await expect(
                vscode.debug.startDebugging(undefined, CONFIG, {
                    parentSession: session,
                    lifecycleManagedByParent: true,
                    consoleMode: vscode.DebugConsoleMode.MergeWithParent,
                    noDebug: true,
                    compact: true,
                    suppressSaveBeforeStart: true,
                    suppressDebugStatusbar: false,
                    suppressDebugToolbar: true,
                    suppressDebugView: false,
                }),
            ).resolves.toBe(true);

            expect(stub.requests).toEqual([
                {
                    method: "debug.startDebugging",
                    params: { folder: FOLDER, nameOrConfig: "Launch", options: { consoleMode: 0 } },
                },
                {
                    method: "debug.startDebugging",
                    params: {
                        nameOrConfig: CONFIG,
                        options: {
                            parentSessionId: "s 1/2",
                            lifecycleManagedByParent: true,
                            consoleMode: 1,
                            noDebug: true,
                            compact: true,
                            suppressSaveBeforeStart: true,
                            suppressDebugStatusbar: false,
                            suppressDebugToolbar: true,
                            suppressDebugView: false,
                        },
                    },
                },
            ]);
        });

        it("a TestRun of the extension's goes as the run and the task the core knows it by", async () => {
            const { stub, vscode } = makeVscode();
            stub.responder = () => true;
            const controller = vscode.tests.createTestController("go", "Go");
            const run = controller.createTestRun(new vscode.TestRunRequest(), "go test");
            const started = stub.notifies.find((n) => n.method === "testing.startedTestRunTask")?.params as {
                runId: string;
                taskId: string;
            };

            await vscode.debug.startDebugging(undefined, CONFIG, { testRun: run });

            const [{ params }] = stub.requests.filter((r) => r.method === "debug.startDebugging");
            expect((params as { options: unknown }).options).toEqual({
                consoleMode: 0,
                testRun: { runId: started.runId, taskId: started.taskId },
            });
        });

        it("a parent session in place of the options, and the old `debugUI.simple` suppresses the UI", async () => {
            const { stub, vscode } = makeVscode();
            stub.responder = () => false;
            const parent = { id: "p", configuration: CONFIG } as never;

            await expect(vscode.debug.startDebugging(undefined, "a", parent)).resolves.toBe(false);
            await vscode.debug.startDebugging(undefined, "b", { debugUI: { simple: true } } as never);

            expect(stub.requests.map((r) => (r.params as { options: unknown }).options)).toEqual([
                { parentSessionId: "p", consoleMode: 0 },
                {
                    consoleMode: 0,
                    suppressDebugStatusbar: true,
                    suppressDebugToolbar: true,
                    suppressDebugView: true,
                },
            ]);
        });

        it("the core's refusal reaches the extension", async () => {
            const { stub, vscode } = makeVscode();
            stub.responder = () => {
                throw new Error("Configured debug type 'go' is not supported.");
            };
            await expect(vscode.debug.startDebugging(undefined, "a")).rejects.toThrow(
                "Configured debug type 'go' is not supported.",
            );
        });

        it("[api:debug.stopDebugging] without a session every session stops; with one, that session", async () => {
            const { stub, vscode } = makeVscode();
            stub.responder = () => null;

            await expect(vscode.debug.stopDebugging()).resolves.toBeUndefined();
            await expect(vscode.debug.stopDebugging(session)).resolves.toBeUndefined();

            expect(stub.requests).toEqual([
                { method: "debug.stopDebugging", params: {} },
                { method: "debug.stopDebugging", params: { sessionId: "s 1/2" } },
            ]);
        });
    });

    it("breakpoints are a no-op", () => {
        const { vscode } = makeVscode();
        const breakpoint = new vscode.FunctionBreakpoint("main");
        vscode.debug.addBreakpoints([breakpoint]);
        vscode.debug.removeBreakpoints([breakpoint]);
        expect(vscode.debug.breakpoints).toEqual([]);
    });

    describe("asDebugSourceUri — as upstream", () => {
        it("a source reference becomes a debug: uri with path, session and ref", () => {
            const { vscode } = makeVscode();
            const uri = vscode.debug.asDebugSourceUri({ path: "/a b.go", sourceReference: 7 } as never, session);
            expect(uri.toString(true)).toBe("debug:/a b.go?session=s 1/2&ref=7");
            expect(uri.scheme).toBe("debug");
            expect(uri.query).toBe("session=s 1/2&ref=7");
        });

        it("without a session only ref; without a path an empty path", () => {
            const { vscode } = makeVscode();
            expect(vscode.debug.asDebugSourceUri({ path: "x", sourceReference: 3 } as never).query).toBe("ref=3");
            const noPath = vscode.debug.asDebugSourceUri({ sourceReference: 3 } as never);
            expect(noPath.scheme).toBe("debug");
            expect(noPath.path).toBe("");
        });

        it("a path without a reference (ref 0 or not a number) becomes a file: uri", () => {
            const { vscode } = makeVscode();
            expect(vscode.debug.asDebugSourceUri({ path: "/w/main.go", sourceReference: 0 } as never).toString()).toBe(
                "file:///w/main.go",
            );
            expect(vscode.debug.asDebugSourceUri({ path: "/w/main.go", sourceReference: "1" } as never).scheme).toBe(
                "file",
            );
        });

        it("neither path nor reference throws the upstream error", () => {
            const { vscode } = makeVscode();
            expect(() => vscode.debug.asDebugSourceUri({ path: 5 } as never)).toThrow(
                "cannot create uri from DAP 'source' object; properties 'path' and 'sourceReference' are both missing.",
            );
        });
    });

    it("the proposed registerDebugVisualizationProvider and TreeProvider are inert no-ops: a disposable, nothing sent", () => {
        const { stub, vscode } = makeVscode();
        const debug = vscode.debug as unknown as Record<
            "registerDebugVisualizationProvider" | "registerDebugVisualizationTreeProvider",
            (id: string, provider: unknown) => { dispose(): void }
        >;
        const registrations = [
            debug.registerDebugVisualizationProvider("hexView", { provideDebugVisualization: () => [] }),
            debug.registerDebugVisualizationTreeProvider("tree", { getTreeItem: () => ({ label: "x" }) }),
        ];
        for (const registration of registrations) {
            expect(() => {
                registration.dispose();
            }).not.toThrow();
        }
        expect(stub.notifies).toStrictEqual([]);
        expect(stub.requests).toStrictEqual([]);
    });
});
