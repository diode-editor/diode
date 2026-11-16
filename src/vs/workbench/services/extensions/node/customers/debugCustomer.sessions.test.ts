import { afterEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import type { IDisposable } from "../../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../../base/common/uri.ts";
import type { IDebuggerExtension } from "../../../../api/common/debugAdapterExecutable.ts";
import { createDebugNamespace } from "../../../../api/common/debugNamespace.ts";
import { FunctionBreakpoint, SourceBreakpoint } from "../../../../api/common/debugTypes.ts";
import type { IWireDebugSession } from "../../../../api/common/debugWireTypes.ts";
import type { HostRpc, SubprocessRpc } from "../../../../api/common/extHostProtocol.ts";
import type { IExtensionDebugEvents, IExtensionDebugSink } from "../../../../api/common/iExtensionDebugSink.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import { ExtensionOwner } from "../../../../api/common/vscodeHostContext.ts";
import { EventEmitter, Location, Position } from "../../../../api/common/vscodeTypes.ts";

import { DebugCustomer } from "./debugCustomer.ts";

const FOLDER: vscode.WorkspaceFolder = { uri: Uri.file("/ws") as unknown as vscode.Uri, name: "ws", index: 0 };
const SESSION: IWireDebugSession = {
    id: "s1",
    type: "lldb",
    name: "Launch",
    folder: FOLDER.uri.toString(),
    configuration: { type: "lldb", name: "Launch", request: "launch" },
};

async function flush(): Promise<void> {
    for (let i = 0; i < 8; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

function recordingSink() {
    const subscriptions: { events: IExtensionDebugEvents; disposed: boolean }[] = [];
    const sink = {
        registerConfigurationProvider: () => ({ dispose: () => undefined }),
        registerDebugTypes: () => ({ dispose: () => undefined }),
        startDebugging: () => Promise.resolve(true),
        stopDebugging: () => Promise.resolve(),
        subscribe: (events: IExtensionDebugEvents): IDisposable => {
            const entry = { events, disposed: false };
            subscriptions.push(entry);
            return {
                dispose: () => {
                    entry.disposed = true;
                },
            };
        },
        customRequest: vi.fn<IExtensionDebugSink["customRequest"]>(() => Promise.resolve({ result: "42" })),
        getDebugProtocolBreakpoint: vi.fn<IExtensionDebugSink["getDebugProtocolBreakpoint"]>(() =>
            Promise.resolve(undefined),
        ),
        setSessionName: vi.fn<IExtensionDebugSink["setSessionName"]>(),
        appendDebugConsole: vi.fn<IExtensionDebugSink["appendDebugConsole"]>(),
        registerBreakpoints: vi.fn<IExtensionDebugSink["registerBreakpoints"]>(),
        unregisterBreakpoints: vi.fn<IExtensionDebugSink["unregisterBreakpoints"]>(),
    } satisfies IExtensionDebugSink;
    return { sink, subscriptions };
}

const attached: IDisposable[] = [];

function setup() {
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a) as unknown as HostRpc;
    const subRpc = new RpcEndpoint(b) as unknown as SubprocessRpc;
    const debug = createDebugNamespace({
        rpc: subRpc,
        owner: new ExtensionOwner(),
        workspaceFolders: () => [FOLDER],
        extensions: { all: [], getExtension: () => undefined },
        onDidReceiveCatalog: new EventEmitter<readonly IDebuggerExtension[]>().event,
    });
    const { sink, subscriptions } = recordingSink();
    const attach = new DebugCustomer(sink).attach({ rpc: hostRpc, logger: undefined });
    attached.push(attach);
    const events = (subscriptions[0] as { events: IExtensionDebugEvents }).events;
    return { debug, sink, subscriptions, events, attach, subRpc };
}

afterEach(() => {
    for (const disposable of attached.splice(0)) disposable.dispose();
});

describe("DebugCustomer — what the core tells extensions about its sessions", () => {
    it("a session's start, end, focus, name and custom events reach the extension; the subscription goes with the spawn", async () => {
        const { debug, events, subscriptions, attach } = setup();
        const seen: string[] = [];
        debug.onDidStartDebugSession((s) => seen.push(`start ${s.id} ${s.workspaceFolder?.name}`));
        debug.onDidChangeActiveDebugSession((s) => seen.push(`active ${s?.id}`));
        debug.onDidReceiveDebugSessionCustomEvent((e) => seen.push(`event ${e.event} ${JSON.stringify(e.body)}`));
        debug.onDidTerminateDebugSession((s) => seen.push(`end ${s.id} ${s.name}`));

        events.sessionStarted(SESSION);
        events.activeSessionChanged(SESSION);
        events.sessionCustomEvent(SESSION, "progressStart", { title: "Loading" });
        events.sessionNameChanged(SESSION, "Renamed");
        events.activeSessionChanged(undefined);
        events.sessionTerminated(SESSION);
        await flush();

        expect(seen).toEqual([
            "start s1 ws",
            "active s1",
            'event progressStart {"title":"Loading"}',
            "active undefined",
            "end s1 Renamed",
        ]);
        expect(subscriptions.map((s) => s.disposed)).toEqual([false]);
        attach.dispose();
        expect(subscriptions.map((s) => s.disposed)).toEqual([true]);
    });

    it("the focused thread or frame reaches the extension as its stack item", async () => {
        const { debug, events } = setup();
        const items: unknown[] = [];
        debug.onDidChangeActiveStackItem((item) =>
            items.push(
                item && {
                    threadId: item.threadId,
                    frameId: (item as { frameId?: number }).frameId,
                    session: item.session.id,
                },
            ),
        );

        events.stackFocusChanged({ session: SESSION, threadId: 3 });
        events.stackFocusChanged({ session: SESSION, threadId: 3, frameId: 9 });
        events.stackFocusChanged(undefined);
        await flush();

        expect(items).toEqual([{ session: "s1", threadId: 3 }, { session: "s1", threadId: 3, frameId: 9 }, undefined]);
    });

    it("breakpoint deltas of the core reach the extension", async () => {
        const { debug, events } = setup();
        events.breakpointsChanged({
            added: [
                { type: "source", id: "b1", enabled: true, uri: "file:///ws/a.c", line: 2, character: 0 },
                { type: "function", id: "f1", enabled: true, functionName: "main" },
            ],
            removed: [],
            changed: [],
        });
        events.breakpointsChanged({ added: [], removed: ["f1"], changed: [] });
        await flush();
        expect(debug.breakpoints.map((bp) => bp.id)).toEqual(["b1"]);
    });
});

describe("DebugCustomer — what extensions ask of the core's sessions", () => {
    it("customRequest reaches the sink and the body comes back; a refusal comes back as the error", async () => {
        const { debug, events, sink } = setup();
        events.activeSessionChanged(SESSION);
        await flush();
        const session = debug.activeDebugSession!;

        await expect(session.customRequest("readMemory", { count: 4 })).resolves.toEqual({ result: "42" });
        expect(sink.customRequest).toHaveBeenCalledWith("s1", "readMemory", { count: 4 });

        sink.customRequest.mockRejectedValueOnce(new Error("unsupported command"));
        await expect(session.customRequest("x")).rejects.toThrow("unsupported command");
    });

    it("getDebugProtocolBreakpoint reaches the sink with the breakpoint's id; the adapter's breakpoint comes back", async () => {
        const { debug, events, sink } = setup();
        events.activeSessionChanged(SESSION);
        await flush();
        const session = debug.activeDebugSession!;
        const bp = new FunctionBreakpoint("main");

        await expect(session.getDebugProtocolBreakpoint(bp)).resolves.toBeUndefined();
        sink.getDebugProtocolBreakpoint.mockResolvedValueOnce({ id: 1, verified: true });
        await expect(session.getDebugProtocolBreakpoint(bp)).resolves.toEqual({ id: 1, verified: true });
        expect(sink.getDebugProtocolBreakpoint).toHaveBeenCalledWith("s1", bp.id);
    });

    it("malformed requests are refused before the sink", async () => {
        const { subRpc, sink } = setup();
        const request = subRpc.request.bind(subRpc) as (method: string, params: unknown) => Promise<unknown>;
        await expect(request("debug.customRequest", { sessionId: 1, command: "x" })).rejects.toThrow(
            "custom request failed",
        );
        await expect(request("debug.getDebugProtocolBreakpoint", { sessionId: "s1" })).rejects.toThrow(
            "debug session not found",
        );
        expect(sink.customRequest).not.toHaveBeenCalled();
        expect(sink.getDebugProtocolBreakpoint).not.toHaveBeenCalled();
    });

    it("a session's new name and console output reach the sink; malformed ones do not", async () => {
        const { debug, events, sink, subRpc } = setup();
        events.activeSessionChanged(SESSION);
        await flush();
        debug.activeDebugSession!.name = "Mine";
        debug.activeDebugConsole.appendLine("hello");
        const notify = subRpc.notify.bind(subRpc) as (method: string, params: unknown) => void;
        notify("debug.setSessionName", { sessionId: "s1" });
        notify("debug.appendDebugConsole", { value: 1 });
        await flush();

        expect(sink.setSessionName.mock.calls).toEqual([["s1", "Mine"]]);
        expect(sink.appendDebugConsole.mock.calls).toEqual([["hello\n"]]);
    });

    it("breakpoints the extension adds and removes reach the sink", async () => {
        const { debug, sink } = setup();
        const source = new SourceBreakpoint(
            new Location(Uri.parse("file:///ws/a.c") as unknown as vscode.Uri, new Position(3, 1)),
        );
        const fn = new FunctionBreakpoint("main", false);

        // `vscode.d.ts` says `void`; upstream returns the promise of the core's answer.
        await (debug.addBreakpoints as (bps: readonly vscode.Breakpoint[]) => Promise<void>)([source, fn]);
        await (debug.removeBreakpoints as (bps: readonly vscode.Breakpoint[]) => Promise<void>)([source, fn]);

        expect(sink.registerBreakpoints.mock.calls).toEqual([
            [
                {
                    breakpoints: [
                        {
                            type: "sourceMulti",
                            uri: "file:///ws/a.c",
                            lines: [{ id: source.id, enabled: true, line: 3, character: 1 }],
                        },
                        { type: "function", id: fn.id, enabled: false, functionName: "main" },
                    ],
                },
            ],
        ]);
        expect(sink.unregisterBreakpoints.mock.calls).toEqual([
            [{ breakpointIds: [source.id], functionBreakpointIds: [fn.id] }],
        ]);
    });
});
