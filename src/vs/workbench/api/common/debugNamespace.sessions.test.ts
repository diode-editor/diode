import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import type { IWireDebugSession } from "./debugWireTypes.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";

const FOLDER = "file:///ws";
const CONFIG = { type: "lldb", name: "Launch", request: "launch", program: "a.out" };
const SESSION: IWireDebugSession = { id: "s1", type: "lldb", name: "Launch", folder: FOLDER, configuration: CONFIG };
const CHILD: IWireDebugSession = {
    id: "s2",
    type: "lldb",
    name: "Child",
    configuration: { ...CONFIG, name: "Child" },
    parentId: "s1",
};

function setup() {
    const stub = makeStubRpc();
    const { namespace } = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk());
    stub.fire("workspace.initialize", { workspaceFolders: [{ uri: FOLDER, name: "ws", index: 0 }] });
    return { stub, vscode: namespace };
}

function sent(stub: ReturnType<typeof makeStubRpc>, method: string): unknown[] {
    return [...stub.notifies, ...stub.requests].filter((m) => m.method === method).map((m) => m.params);
}

describe("vscode.debug — the core's sessions", () => {
    it("[api:debug.onDidStartDebugSession] a started session comes with what the core said of it", () => {
        const { stub, vscode } = setup();
        const started: vscode.DebugSession[] = [];
        vscode.debug.onDidStartDebugSession((s) => started.push(s));

        stub.fire("debug.acceptSessionStarted", { session: SESSION });
        stub.fire("debug.acceptSessionStarted", { session: CHILD });

        const [session, child] = started as [vscode.DebugSession, vscode.DebugSession];
        expect(session).toMatchObject({ id: "s1", type: "lldb", name: "Launch", configuration: CONFIG });
        expect(session.workspaceFolder?.uri.toString()).toBe(FOLDER);
        expect(session.parentSession).toBeUndefined();
        expect(child.workspaceFolder).toBeUndefined();
        expect(child.parentSession).toBe(session);
        expect(Object.isFrozen(session)).toBe(true);
    });

    it("[api:debug.onDidTerminateDebugSession] one object per session until it terminates; a later message is a new one", () => {
        const { stub, vscode } = setup();
        const seen: vscode.DebugSession[] = [];
        vscode.debug.onDidStartDebugSession((s) => seen.push(s));
        vscode.debug.onDidTerminateDebugSession((s) => seen.push(s));

        stub.fire("debug.acceptSessionStarted", { session: SESSION });
        stub.fire("debug.acceptSessionTerminated", { session: SESSION });
        stub.fire("debug.acceptSessionStarted", { session: SESSION });

        expect(seen).toHaveLength(3);
        expect(seen[1]).toBe(seen[0]);
        expect(seen[2]).not.toBe(seen[0]);
    });

    it("the session a descriptor factory gets is the one the events carry", async () => {
        const { stub, vscode } = setup();
        stub.fire("extensions.catalog", {
            extensions: [
                { id: "x.lldb", extensionPath: "/x", packageJSON: { contributes: { debuggers: [{ type: "lldb" }] } } },
            ],
        });
        const factory = vi.fn(() => undefined);
        vscode.debug.registerDebugAdapterDescriptorFactory("lldb", { createDebugAdapterDescriptor: factory });
        const started: vscode.DebugSession[] = [];
        vscode.debug.onDidStartDebugSession((s) => started.push(s));

        await stub.callRequest("debug.startAdapter", { handle: 1, session: SESSION }).catch(() => undefined);
        await stub.callRequest("debug.stopAdapter", { handle: 1 });
        stub.fire("debug.acceptSessionStarted", { session: SESSION });

        expect(started[0]).toBe((factory.mock.calls[0] as unknown[])[0]);
    });

    it("[api:debug.activeDebugSession] [api:debug.onDidChangeActiveDebugSession] follow the core's focused session", () => {
        const { stub, vscode } = setup();
        const changes: (vscode.DebugSession | undefined)[] = [];
        vscode.debug.onDidChangeActiveDebugSession((s) => changes.push(s));

        stub.fire("debug.acceptActiveSessionChanged", { session: SESSION });
        const active = vscode.debug.activeDebugSession;
        stub.fire("debug.acceptActiveSessionChanged", {});

        expect(active?.id).toBe("s1");
        expect(changes).toEqual([active, undefined]);
        expect(vscode.debug.activeDebugSession).toBeUndefined();
    });

    it("[api:debug.onDidReceiveDebugSessionCustomEvent] carries the session, the event and its body", () => {
        const { stub, vscode } = setup();
        const events: vscode.DebugSessionCustomEvent[] = [];
        vscode.debug.onDidReceiveDebugSessionCustomEvent((e) => events.push(e));

        stub.fire("debug.acceptSessionCustomEvent", { session: SESSION, event: "progress", body: { n: 1 } });

        expect(events.map((e): unknown[] => [e.session.id, e.event, e.body])).toEqual([["s1", "progress", { n: 1 }]]);
    });

    it("a session's name follows the core's; setting it renames the core's session", () => {
        const { stub, vscode } = setup();
        stub.fire("debug.acceptActiveSessionChanged", { session: SESSION });
        const session = vscode.debug.activeDebugSession!;

        stub.fire("debug.acceptSessionNameChanged", { session: SESSION, name: "Renamed by core" });
        expect(session.name).toBe("Renamed by core");

        session.name = "Renamed by extension";
        expect(session.name).toBe("Renamed by extension");
        expect(sent(stub, "debug.setSessionName")).toEqual([{ sessionId: "s1", name: "Renamed by extension" }]);
    });

    it("customRequest asks the core's session and resolves to the response's body", async () => {
        const { stub, vscode } = setup();
        stub.responder = (method) => (method === "debug.customRequest" ? { body: { result: 42 } } : undefined);
        stub.fire("debug.acceptActiveSessionChanged", { session: SESSION });
        const session = vscode.debug.activeDebugSession!;

        await expect(session.customRequest("evaluate", { expression: "x" })).resolves.toEqual({ result: 42 });
        expect(sent(stub, "debug.customRequest")).toEqual([
            { sessionId: "s1", command: "evaluate", args: { expression: "x" } },
        ]);
    });

    it("customRequest rejects with the core's error", async () => {
        const { stub, vscode } = setup();
        stub.responder = () => Promise.reject(new Error("custom request failed"));
        stub.fire("debug.acceptActiveSessionChanged", { session: SESSION });

        await expect(vscode.debug.activeDebugSession?.customRequest("x")).rejects.toThrow("custom request failed");
    });

    it("getDebugProtocolBreakpoint asks by the breakpoint's id: the adapter's breakpoint or undefined", async () => {
        const { stub, vscode } = setup();
        const bp = new vscode.FunctionBreakpoint("main");
        stub.responder = (_method, params) =>
            (params as { breakpointId: string }).breakpointId === bp.id
                ? { breakpoint: { id: 7, verified: true } }
                : {};
        stub.fire("debug.acceptActiveSessionChanged", { session: SESSION });
        const session = vscode.debug.activeDebugSession!;

        await expect(session.getDebugProtocolBreakpoint(bp)).resolves.toEqual({ id: 7, verified: true });
        await expect(session.getDebugProtocolBreakpoint(new vscode.FunctionBreakpoint("f"))).resolves.toBeUndefined();
        expect(sent(stub, "debug.getDebugProtocolBreakpoint")[0]).toEqual({ sessionId: "s1", breakpointId: bp.id });
    });
});

describe("vscode.debug — the focused thread or frame", () => {
    it("[api:debug.activeStackItem] [api:debug.onDidChangeActiveStackItem] a thread, a frame, then nothing", () => {
        const { stub, vscode } = setup();
        const items: unknown[] = [];
        vscode.debug.onDidChangeActiveStackItem((item) => items.push(item));

        stub.fire("debug.acceptStackFocus", { focus: { session: SESSION, threadId: 1 } });
        const thread = vscode.debug.activeStackItem;
        stub.fire("debug.acceptStackFocus", { focus: { session: SESSION, threadId: 1, frameId: 1000 } });
        const frame = vscode.debug.activeStackItem;
        stub.fire("debug.acceptStackFocus", {});

        expect(thread).toBeInstanceOf(vscode.DebugThread);
        expect(thread).toMatchObject({ threadId: 1 });
        expect((thread as vscode.DebugThread).session.id).toBe("s1");
        expect(thread).not.toHaveProperty("frameId");
        expect(frame).toBeInstanceOf(vscode.DebugStackFrame);
        expect(frame).toMatchObject({ threadId: 1, frameId: 1000 });
        expect((frame as vscode.DebugStackFrame).session).toBe((thread as vscode.DebugThread).session);
        expect(items).toEqual([thread, frame, undefined]);
        expect(vscode.debug.activeStackItem).toBeUndefined();
    });
});

describe("vscode.debug — the debug console", () => {
    it("[api:debug.activeDebugConsole] append and appendLine go to the core", () => {
        const { stub, vscode } = setup();
        vscode.debug.activeDebugConsole.append("a");
        vscode.debug.activeDebugConsole.appendLine("b");
        expect(sent(stub, "debug.appendDebugConsole")).toEqual([{ value: "a" }, { value: "b\n" }]);
    });
});
