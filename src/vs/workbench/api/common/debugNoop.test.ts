import { describe, expect, it, vi } from "vitest";

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

describe("vscode.debug — null object: there are no sessions and never will be", () => {
    it("the state is empty: no session, breakpoints or stack frame; the console accepts output", () => {
        const { vscode } = makeVscode();
        expect(vscode.debug.activeDebugSession).toBeUndefined();
        expect(vscode.debug.activeStackItem).toBeUndefined();
        expect(vscode.debug.breakpoints).toEqual([]);
        expect(() => {
            vscode.debug.activeDebugConsole.append("a");
            vscode.debug.activeDebugConsole.appendLine("b");
        }).not.toThrow();
    });

    it("events are valid subscriptions that never fire", () => {
        const { vscode } = makeVscode();
        const listener = vi.fn();
        const events = [
            vscode.debug.onDidChangeActiveDebugSession,
            vscode.debug.onDidStartDebugSession,
            vscode.debug.onDidReceiveDebugSessionCustomEvent,
            vscode.debug.onDidTerminateDebugSession,
            vscode.debug.onDidChangeBreakpoints,
            vscode.debug.onDidChangeActiveStackItem,
        ];
        for (const event of events) event(listener).dispose();
        expect(listener).not.toHaveBeenCalled();
    });

    it("register* return a Disposable; nobody calls the providers", () => {
        const { vscode } = makeVscode();
        const provider = { provideDebugConfigurations: vi.fn(), resolveDebugConfiguration: vi.fn() };
        const factory = { createDebugAdapterDescriptor: vi.fn() };
        const tracker = { createDebugAdapterTracker: vi.fn() };
        const disposables = [
            vscode.debug.registerDebugConfigurationProvider("go", provider),
            vscode.debug.registerDebugAdapterDescriptorFactory("go", factory),
            vscode.debug.registerDebugAdapterTrackerFactory("*", tracker),
        ];
        for (const disposable of disposables) {
            expect(() => {
                disposable.dispose();
            }).not.toThrow();
        }
        expect(provider.provideDebugConfigurations).not.toHaveBeenCalled();
        expect(factory.createDebugAdapterDescriptor).not.toHaveBeenCalled();
        expect(tracker.createDebugAdapterTracker).not.toHaveBeenCalled();
    });

    it("startDebugging is false, stopDebugging resolves, breakpoints are a no-op", async () => {
        const { vscode } = makeVscode();
        await expect(vscode.debug.startDebugging(undefined, "Launch")).resolves.toBe(false);
        await expect(vscode.debug.stopDebugging()).resolves.toBeUndefined();
        const breakpoint = new vscode.FunctionBreakpoint("main");
        vscode.debug.addBreakpoints([breakpoint]);
        vscode.debug.removeBreakpoints([breakpoint]);
        expect(vscode.debug.breakpoints).toEqual([]);
    });

    it("the user gets one line per debugger type and one per start attempt; trackers stay silent", async () => {
        const { stub, vscode } = makeVscode();
        vscode.debug.registerDebugConfigurationProvider("go", {});
        vscode.debug.registerDebugAdapterDescriptorFactory("go", { createDebugAdapterDescriptor: () => undefined });
        vscode.debug.registerDebugConfigurationProvider("delve", {});
        vscode.debug.registerDebugAdapterDescriptorFactory("lldb", { createDebugAdapterDescriptor: () => undefined });
        vscode.debug.registerDebugAdapterTrackerFactory("*", { createDebugAdapterTracker: () => undefined });
        await vscode.debug.startDebugging(undefined, "a");
        await vscode.debug.startDebugging(undefined, "b");
        expect(warnings(stub)).toEqual([
            'extensions/Extensions/warn: debugging "go" is not supported in TUI yet — no sessions, the rest of the extension works',
            'extensions/Extensions/warn: debugging "delve" is not supported in TUI yet — no sessions, the rest of the extension works',
            'extensions/Extensions/warn: debugging "lldb" is not supported in TUI yet — no sessions, the rest of the extension works',
            "extensions/Extensions/warn: starting a debug session is not supported in TUI yet — no session started",
        ]);
    });

    it("every start attempt is a warning toast without buttons; startDebugging does not wait for its dismissal", async () => {
        const { stub, vscode } = makeVscode();
        stub.responder = () => new Promise(() => undefined);
        await expect(vscode.debug.startDebugging(undefined, "a")).resolves.toBe(false);
        await expect(vscode.debug.startDebugging(undefined, "b")).resolves.toBe(false);
        const toast = {
            method: "window.showMessage",
            params: {
                severity: "warn",
                message: "starting a debug session is not supported in TUI yet — no session started",
                modal: false,
                detail: undefined,
                items: [],
            },
        };
        expect(stub.requests).toEqual([toast, toast]);
    });

    it("a toast that cannot be shown costs the extension nothing", async () => {
        const { stub, vscode } = makeVscode();
        stub.responder = () => {
            throw new Error("host is gone");
        };
        const unhandled = vi.fn();
        process.on("unhandledRejection", unhandled);
        try {
            await expect(vscode.debug.startDebugging(undefined, "a")).resolves.toBe(false);
            await new Promise((resolve) => setImmediate(resolve));
            expect(unhandled).not.toHaveBeenCalled();
        } finally {
            process.off("unhandledRejection", unhandled);
        }
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
});
