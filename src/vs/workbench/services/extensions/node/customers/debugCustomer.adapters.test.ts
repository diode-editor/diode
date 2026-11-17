import { afterEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { SESSIONLESS_DEBUG_SINK } from "../../../../../../TestUtils/debugSinkStub.ts";
import type { IDisposable } from "../../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../../base/common/uri.ts";
import type { IDebuggerExtension } from "../../../../api/common/debugAdapterExecutable.ts";
import { createDebugNamespace } from "../../../../api/common/debugNamespace.ts";
import { DebugAdapterInlineImplementation } from "../../../../api/common/debugTypes.ts";
import type { IWireDebugSession } from "../../../../api/common/debugWireTypes.ts";
import type { HostRpc, SubprocessRpc } from "../../../../api/common/extHostProtocol.ts";
import type {
    IExtensionDebugAdapterHost,
    IExtensionDebugAdapterListener,
    IExtensionDebugSink,
} from "../../../../api/common/iExtensionDebugSink.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import { ExtensionOwner } from "../../../../api/common/vscodeHostContext.ts";
import { EventEmitter } from "../../../../api/common/vscodeTypes.ts";

import { DebugCustomer } from "./debugCustomer.ts";

const EXT = "vadimcn.vscode-lldb";
const CATALOG: (IDebuggerExtension & { id: string })[] = [
    { id: EXT, extensionPath: "/ext", packageJSON: { contributes: { debuggers: [{ type: "lldb", label: "LLDB" }] } } },
];
const SESSION: IWireDebugSession = {
    id: "s1",
    type: "lldb",
    name: "Launch",
    configuration: { type: "lldb", name: "Launch", request: "launch" },
};

async function flush(): Promise<void> {
    for (let i = 0; i < 8; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

interface IRegistration {
    readonly types: readonly string[];
    readonly host: IExtensionDebugAdapterHost;
    disposed: number;
}

/** What the sink saw, in order: `register a,b` and `dispose a,b`. */
const journal: string[] = [];

function sink(registrations: IRegistration[]): IExtensionDebugSink {
    return {
        ...SESSIONLESS_DEBUG_SINK,
        registerDebugTypes: (types, host): IDisposable => {
            const registration = { types, host, disposed: 0 };
            registrations.push(registration);
            journal.push(`register ${types.join(",")}`);
            return {
                dispose: () => {
                    registration.disposed++;
                    journal.push(`dispose ${types.join(",")}`);
                },
            };
        },
        registerConfigurationProvider: () => ({ dispose: () => undefined }),
        startDebugging: () => Promise.resolve(true),
        stopDebugging: () => Promise.resolve(),
    };
}

function listener() {
    const seen = { messages: [] as unknown[], errors: [] as Error[], exits: [] as unknown[] };
    const l: IExtensionDebugAdapterListener = {
        onMessage: (m) => seen.messages.push(m),
        onError: (e) => seen.errors.push(e),
        onExit: (c) => seen.exits.push(c),
    };
    return { seen, listener: l };
}

const attached: IDisposable[] = [];

function setup() {
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a) as unknown as HostRpc;
    const subRpc = new RpcEndpoint(b) as unknown as SubprocessRpc;
    const owner = new ExtensionOwner();
    const catalog = new EventEmitter<readonly IDebuggerExtension[]>();
    const debug = createDebugNamespace({
        rpc: subRpc,
        owner,
        workspaceFolders: () => [],
        extensions: { all: CATALOG, getExtension: (id) => CATALOG.find((e) => e.id === id) },
        onDidReceiveCatalog: catalog.event,
    });
    const registrations: IRegistration[] = [];
    const attach = new DebugCustomer(sink(registrations)).attach({ rpc: hostRpc, logger: undefined });
    attached.push(attach);
    return { debug, owner, attach, catalog, registrations, hostRpc, subRpc };
}

/** An inline adapter of the extension's factory for `lldb`, the messages it got, and a way to talk back. */
function inlineAdapter(debug: typeof vscode.debug, owner: ExtensionOwner) {
    const emitter = new EventEmitter<vscode.DebugProtocolMessage>();
    const received: unknown[] = [];
    owner.runAs(EXT, () =>
        debug.registerDebugAdapterDescriptorFactory("lldb", {
            createDebugAdapterDescriptor: () =>
                new DebugAdapterInlineImplementation({
                    onDidSendMessage: emitter.event,
                    handleMessage: (m) => received.push(m),
                    dispose: () => undefined,
                }),
        }),
    );
    return { emitter, received };
}

afterEach(() => {
    for (const disposable of attached.splice(0)) disposable.dispose();
});

describe("DebugCustomer — debug adapters over the wire (upstream $registerDebugTypes, $startDASession and the rest)", () => {
    it("a catalog of the subprocess registers its debug types with the sink; the next one replaces them, the old ones go first", async () => {
        journal.length = 0;
        const { catalog, registrations } = setup();
        catalog.fire(CATALOG);
        await flush();
        catalog.fire([]);
        await flush();
        expect(registrations.map((r) => ({ types: r.types, disposed: r.disposed }))).toEqual([
            { types: ["lldb"], disposed: 1 },
            { types: [], disposed: 0 },
        ]);
        // The old registration's dispose drops the factory of its types: it must not drop the new one's.
        expect(journal).toEqual(["register lldb", "dispose lldb", "register "]);
    });

    it("an adapter of the host starts in the subprocess, messages go both ways, errors and exits come back; stop stops it", async () => {
        const { debug, owner, catalog, registrations } = setup();
        const { emitter, received } = inlineAdapter(debug, owner);
        catalog.fire(CATALOG);
        await flush();
        const { seen, listener: l } = listener();
        const connection = registrations[0].host.createAdapter(SESSION, l);

        await connection.start();
        connection.send({ seq: 1, type: "request", command: "initialize" } as DebugProtocol.Request);
        await flush();
        expect(received).toEqual([{ seq: 1, type: "request", command: "initialize" }]);
        emitter.fire({ seq: 1, type: "response", command: "initialize", request_seq: 1, success: true } as never);
        await flush();
        expect(seen.messages).toEqual([
            { seq: 1, type: "response", command: "initialize", request_seq: 1, success: true },
        ]);

        await connection.stop();
        emitter.fire({ seq: 2, type: "event", event: "late" } as never);
        await flush();
        expect(seen.messages).toHaveLength(1);
    });

    it("a start the subprocess fails rejects with its message", async () => {
        const { catalog, registrations } = setup();
        catalog.fire(CATALOG);
        await flush();
        const connection = registrations[0].host.createAdapter(SESSION, listener().listener);
        await expect(connection.start()).rejects.toThrow(
            "Couldn't find a debug adapter descriptor for debug type 'lldb'",
        );
    });

    it("each adapter has its own handle: errors and exits reach only their listener", async () => {
        const { catalog, registrations, subRpc } = setup();
        catalog.fire(CATALOG);
        await flush();
        const first = listener();
        const second = listener();
        registrations[0].host.createAdapter(SESSION, first.listener);
        registrations[0].host.createAdapter(SESSION, second.listener);

        const serialized = (name: string, message: string, code?: string) =>
            ({ $isError: true, name, message, stack: `${name}: ${message}\n    at x`, code }) as const;
        subRpc.notify("debug.acceptAdapterError", { handle: 2, error: serialized("TypeError", "boom", "ENOENT") });
        subRpc.notify("debug.acceptAdapterError", { handle: 1, error: serialized("Error", "plain") });
        subRpc.notify("debug.acceptAdapterExit", { handle: 1, code: 3 });
        subRpc.notify("debug.acceptAdapterExit", { handle: 2 });
        subRpc.notify("debug.acceptAdapterMessage", { handle: 2, message: { seq: 1, type: "event", event: "e" } });
        await flush();

        expect(second.seen.errors.map((e) => [e.name, e.message, e.stack, (e as { code?: string }).code])).toEqual([
            ["TypeError", "boom", "TypeError: boom\n    at x", "ENOENT"],
        ]);
        expect(first.seen.errors.map((e) => [e.name, e.message])).toEqual([["Error", "plain"]]);
        expect(first.seen.exits).toEqual([3]);
        expect(second.seen.exits).toEqual([undefined]);
        expect(second.seen.messages).toEqual([{ seq: 1, type: "event", event: "e" }]);
        expect(first.seen.messages).toEqual([]);
    });

    it("malformed or unknown messages from the subprocess are dropped", async () => {
        const { catalog, registrations, subRpc } = setup();
        catalog.fire(CATALOG);
        await flush();
        const { seen, listener: l } = listener();
        registrations[0].host.createAdapter(SESSION, l);
        for (const params of [
            null,
            { handle: "1" },
            { handle: 1, message: { seq: 1 } },
            { handle: 9, message: { type: "event" } },
        ]) {
            subRpc.notify("debug.acceptAdapterMessage", params as never);
        }
        subRpc.notify("debug.acceptAdapterError", { message: "x" } as never);
        subRpc.notify("debug.acceptAdapterError", {
            handle: 1,
            error: { name: "E", message: "m", stack: "s" },
        } as never);
        subRpc.notify("debug.acceptAdapterExit", { code: 1 } as never);
        subRpc.notify("debug.registerDebugTypes", { types: ["a", 7, null] } as never);
        await flush();
        expect(seen).toEqual({ messages: [], errors: [], exits: [] });
        expect(registrations.at(-1)?.types).toEqual(["a"]);
    });

    it("a subprocess that goes away ends every live adapter with 'Extension host shut down'; later calls are no-ops", async () => {
        const { catalog, registrations, attach, hostRpc } = setup();
        catalog.fire(CATALOG);
        await flush();
        const live = listener();
        const stopped = listener();
        const connection = registrations[0].host.createAdapter(SESSION, live.listener);
        const other = registrations[0].host.createAdapter(SESSION, stopped.listener);
        await other.stop().catch(() => undefined);

        attach.dispose();
        expect(registrations[0].disposed).toBe(1);
        expect(live.seen.errors.map((e) => e.message)).toEqual(["Extension host shut down"]);
        expect(stopped.seen.errors).toEqual([]);

        const notify = vi.spyOn(hostRpc, "notify");
        const request = vi.spyOn(hostRpc, "request");
        connection.send({ seq: 1, type: "request", command: "threads" } as DebugProtocol.Request);
        await expect(connection.stop()).resolves.toBeUndefined();
        expect(notify).not.toHaveBeenCalled();
        expect(request).not.toHaveBeenCalled();
    });
});
